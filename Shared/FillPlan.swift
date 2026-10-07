import Foundation

struct FormField: Codable {
    struct Option: Codable { let value: String; let text: String; let disabled: Bool }
    let id: String
    var groupID: String? = nil
    let tag: String
    let type: String
    let label: String
    let ariaLabel: String
    let name: String
    let htmlID: String
    let placeholder: String
    let autocomplete: String
    let context: String
    let maxLength: Int
    let pattern: String
    let occupied: Bool
    let options: [Option]

    var hint: String { [label, ariaLabel, name, htmlID, placeholder, context].joined(separator: " ").lowercased() }
    var isPostalControl: Bool { autocomplete.split(separator: " ").contains("postal-code") || (name + " " + htmlID).range(of: "zip|postal|postcode|郵便番号", options: [.regularExpression, .caseInsensitive]) != nil || (label + " " + ariaLabel).contains("郵便番号") }
    var displayLabel: String { [label, ariaLabel, placeholder, name, htmlID].first(where: { !$0.isEmpty }) ?? id }
    var numberedAddressLine: Int? {
        let text = [label, ariaLabel, placeholder, autocomplete].joined(separator: " ")
            .folding(options: .widthInsensitive, locale: Locale(identifier: "en_US_POSIX"))
        let pattern = "(?:住所|address[-_ ]?line)\\s*([123])(?![0-9])"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        let numbers = Set(matches.compactMap { match -> Int? in
            guard let range = Range(match.range(at: 1), in: text) else { return nil }
            return Int(text[range])
        })
        return numbers.count == 1 ? numbers.first : nil
    }
    var isPrefectureSelect: Bool {
        tag == "select" && options.filter {
            $0.text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: "^(東京都|北海道|京都府|大阪府|.{2,3}県)$", options: .regularExpression) != nil
        }.count >= 2
    }
}

enum AddressComponent: String, Codable, CaseIterable {
    // Canonical output order belongs to the app, never to model array order.
    case prefecture, municipality, locality, street, building
}

enum FieldKind: Equatable {
    case family, given, fullName, familyKana, givenKana, fullKana
    case postal, postalFirst3, postalLast4
    case address([AddressComponent])
    case unknown

    static let nonAddressKinds: [FieldKind] = [.family, .given, .fullName, .familyKana, .givenKana, .fullKana,
        .postal, .postalFirst3, .postalLast4, .unknown]
    static let permittedKinds = nonAddressKinds.map(\.rawValue) + ["address"]

    var rawValue: String {
        switch self {
        case .family: return "family"
        case .given: return "given"
        case .fullName: return "fullName"
        case .familyKana: return "familyKana"
        case .givenKana: return "givenKana"
        case .fullKana: return "fullKana"
        case .postal: return "postal"
        case .postalFirst3: return "postalFirst3"
        case .postalLast4: return "postalLast4"
        case .address: return "address"
        case .unknown: return "unknown"
        }
    }
    var components: [AddressComponent] {
        guard case let .address(parts) = self else { return [] }
        return AddressComponent.allCases.filter { parts.contains($0) }
    }
    init?(kind: String, components: [String]) {
        guard kind == "address" else {
            guard components.isEmpty, let value = Self.nonAddressKinds.first(where: { $0.rawValue == kind }) else { return nil }
            self = value
            return
        }
        guard !components.isEmpty, components.count <= AddressComponent.allCases.count,
              Set(components).count == components.count,
              components.allSatisfy({ AddressComponent(rawValue: $0) != nil }) else { return nil }
        self = .address(AddressComponent.allCases.filter { components.contains($0.rawValue) })
    }
}

// Synthetic data only. The classifier never receives this profile.
struct DummyProfile: ProfileValues {
    let id = "dummy-v1"
    let family = "山田"
    let given = "太郎"
    let familyKana = "ヤマダ"
    let givenKana = "タロウ"
    let postal = "1000001"
    let prefecture = "東京都"
    let municipality = "千代田区"
    let locality = "千代田"
    let street = "1-1"
    let building = "テストマンション101号室"
}

protocol ProfileValues {
    var id: String { get }
    var family: String { get }
    var given: String { get }
    var familyKana: String { get }
    var givenKana: String { get }
    var postal: String { get }
    var prefecture: String { get }
    var municipality: String { get }
    var locality: String { get }
    var street: String { get }
    var building: String { get }
}

extension ProfileValues {
    func value(for kind: FieldKind) -> String? {
        switch kind {
        case .family: return family
        case .given: return given
        case .fullName: return family + " " + given
        case .familyKana: return familyKana
        case .givenKana: return givenKana
        case .fullKana: return familyKana + " " + givenKana
        case .postal: return postal
        case .postalFirst3: return String(postal.prefix(3))
        case .postalLast4: return String(postal.suffix(4))
        case .address(let parts):
            guard !parts.isEmpty, Set(parts).count == parts.count else { return nil }
            return AddressComponent.allCases.filter { parts.contains($0) }.map { part in
                switch part {
                case .prefecture: return prefecture
                case .municipality: return municipality
                case .locality: return locality
                case .street: return street
                case .building: return (parts.count > 1 ? " " : "") + building
                }
            }.joined()
        case .unknown: return nil
        }
    }
}

enum FillPlanner {
    static func fieldGroups(_ fields: [FormField]) -> [[FormField]] {
        var keys = [String]()
        var groups = [[FormField]]()
        for field in fields {
            let tokens = field.autocomplete.lowercased().split(separator: " ")
            let scope = tokens.filter { $0.hasPrefix("section-") || ["shipping", "billing"].contains(String($0)) }.joined(separator: " ")
            let key = field.groupID ?? scope
            if let index = keys.firstIndex(of: key) { groups[index].append(field) }
            else { keys.append(key); groups.append([field]) }
        }
        return groups
    }
    static func classificationBatches(fields: [FormField], kinds: [String: FieldKind]) -> [[FormField]] {
        fieldGroups(fields).flatMap { group in
            let pending = fieldsNeedingClassification(group, kinds: kinds)
            return stride(from: 0, to: pending.count, by: 4).map { Array(pending[$0..<min($0 + 4, pending.count)]) }
        }
    }
    static func siblingContext(fields: [FormField], requestedIDs: Set<String>) -> [FormField] {
        let group = fieldGroups(fields).first { $0.contains { requestedIDs.contains($0.id) } } ?? []
        let requestedIndices = group.indices.filter { requestedIDs.contains(group[$0].id) }
        let closest = group.indices.sorted { left, right in
            let leftDistance = requestedIndices.map { abs($0 - left) }.min() ?? 0
            let rightDistance = requestedIndices.map { abs($0 - right) }.min() ?? 0
            return leftDistance == rightDistance ? left < right : leftDistance < rightDistance
        }.prefix(8).sorted()
        return closest.map { group[$0] }
    }
    // Interpret an explicit address range using the canonical component order.
    static func addressRangeComponents(_ label: String) -> [AddressComponent]? {
        let starts: [(AddressComponent, String)] = [
            (.prefecture, "都道府県"), (.municipality, "市区(?:町村郡|町村|郡)|市町村"),
            (.locality, "町名|町域"), (.street, "丁目|番地"), (.building, "建物名|建物")
        ]
        for (component, names) in starts {
            if label.range(of: "(?:\(names))\\s*(?:以下|以降|から)", options: .regularExpression) != nil {
                return Array(AddressComponent.allCases.drop { $0 != component })
            }
        }
        return nil
    }
    // Complement broad address fields with explicitly classified sibling controls.
    static func contextualAddressKinds(fields: [FormField], kinds: [String: FieldKind]) -> [String: FieldKind] {
        var result = kinds
        for group in fieldGroups(fields) {
            for field in group {
                let kind = kinds[field.id]
                let label = field.label.trimmingCharacters(in: .whitespacesAndNewlines)
                let placeholder = field.placeholder.folding(options: .widthInsensitive, locale: Locale(identifier: "en_US_POSIX"))
                    .replacingOccurrences(of: "(?:必須|任意|[()（）\\s])", with: "", options: .regularExpression)
                let barePlaceholder = placeholder.isEmpty || ["住所", "ご住所", "住所1"].contains(placeholder)
                let generic = barePlaceholder && (["住所", "ご住所", "住所1", "住所１"].contains(label)
                    || (label.isEmpty && field.numberedAddressLine == 1))
                let explicitRange = addressRangeComponents(field.label + " " + field.ariaLabel) != nil
                guard kind == .address([.prefecture, .municipality, .locality, .street, .building]) || kind == .address([.municipality, .locality, .street, .building]) || (kind != nil && explicitRange) || (kind == nil && generic) else { continue }
                let base: FieldKind = kind ?? .address([.prefecture, .municipality, .locality, .street, .building])
                let siblings = group.filter { $0.id != field.id }
                let covered = siblings.reduce(into: Set<String>()) { components, sibling in
                    let siblingKind = kinds[sibling.id] ?? .unknown
                    if siblingKind != .address([.prefecture, .municipality, .locality, .street, .building]) && siblingKind != .address([.municipality, .locality, .street, .building]) {
                        components.formUnion(addressComponents(siblingKind))
                    }
                }
                guard !covered.isEmpty else { continue }
                let remaining = addressComponents(base).subtracting(covered)
                // Only infer a bare address when siblings explain its layout.
                if kind == nil && !covered.contains("municipality") && !covered.contains("building") { continue }
                if !remaining.isEmpty {
                    result[field.id] = .address(AddressComponent.allCases.filter { remaining.contains($0.rawValue) })
                }
            }
        }
        return result
    }

    static func numberedAddressGroups(_ fields: [FormField]) -> [[FormField]] {
        var groups = [[FormField]]()
        var current = [FormField]()
        for field in fields {
            if let previous = current.last, field.groupID != previous.groupID {
                if current.count >= 2 { groups.append(current) }; current = []
            }
            if field.numberedAddressLine == 1 {
                if current.count >= 2 { groups.append(current) }
                current = [field]
            } else if !current.isEmpty && field.numberedAddressLine == current.count + 1 {
                current.append(field)
            } else {
                if current.count >= 2 { groups.append(current) }
                current = []
            }
        }
        if current.count >= 2 { groups.append(current) }
        return groups
    }
    // Product default for three otherwise undescribed address lines.
    // Explicit components/examples and separate region controls take precedence.
    static func numberedAddressDefaults(fields: [FormField], kinds: [String: FieldKind]) -> [String: FieldKind] {
        func bare(_ field: FormField) -> Bool {
            let pattern = "^(?:ご?住所[123]?|address(?:[-_ ]?line)?[-_ ]?[123]?|)$"
            let strings = [field.label, field.ariaLabel, field.placeholder, field.context]
            let plain = strings.allSatisfy { value in
                let normalized = value.folding(options: .widthInsensitive, locale: Locale(identifier: "en_US_POSIX"))
                    .replacingOccurrences(of: "(?:必須|任意|required|optional|[()\\s])", with: "", options: [.regularExpression, .caseInsensitive])
                return normalized.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
            }
            let token = field.autocomplete.lowercased().split(separator: " ").last.map(String.init) ?? ""
            return plain && ["", "address-line1", "address-line2", "address-line3"].contains(token)
                && field.tag != "select" && kinds[field.id] == nil
        }
        var defaults = [String: FieldKind]()
        for group in numberedAddressGroups(fields) where group.count == 3 && group.allSatisfy(bare) {
            let ids = Set(group.map(\.id))
            // Only region controls in the same ownership group constrain the default.
            let siblings = fieldGroups(fields).first { $0.contains { $0.id == group[0].id } } ?? []
            guard !siblings.contains(where: { !ids.contains($0.id) && !addressComponents(kinds[$0.id] ?? .unknown).isEmpty }) else { continue }
            defaults[group[0].id] = .address([.prefecture, .municipality])
            defaults[group[1].id] = .address([.locality, .street])
            defaults[group[2].id] = .address([.building])
        }
        return defaults
    }
    static func addressComponents(_ kind: FieldKind) -> Set<String> {
        Set(kind.components.map(\.rawValue))
    }
    static func overlappingAddressGroups(fields: [FormField], kinds: [String: FieldKind]) -> [[FormField]] {
        let groups = fieldGroups(fields).flatMap { group in
            group.contains(where: { $0.groupID != nil })
                ? [group.filter { !addressComponents(kinds[$0.id] ?? .unknown).isEmpty }]
                : numberedAddressGroups(group)
        }
        return groups.filter { group in
            var seen = Set<String>()
            for field in group {
                let components = addressComponents(kinds[field.id] ?? .unknown)
                if !seen.isDisjoint(with: components) { return true }
                seen.formUnion(components)
            }
            return false
        }
    }
    // A partial component allocation is a reason to ask the model to check its
    // examples again, never a reason to insert the missing component ourselves.
    static func addressReviewBatches(fields: [FormField], kinds: [String: FieldKind], sources: [String: String]) -> [[FormField]] {
        let overlappingIDs = Set(overlappingAddressGroups(fields: fields, kinds: kinds).flatMap { $0.map(\.id) })
        let core = Set(["municipality", "locality", "street"])
        return fieldGroups(fields).flatMap { group -> [[FormField]] in
            let covered = group.reduce(into: Set<String>()) { $0.formUnion(addressComponents(kinds[$1.id] ?? .unknown)) }
            let incomplete = covered.intersection(core).count >= 2 && !core.isSubset(of: covered)
            guard incomplete || group.contains(where: { overlappingIDs.contains($0.id) }) else { return [] }
            let candidates = group.filter { sources[$0.id] == "model" && !addressComponents(kinds[$0.id] ?? .unknown).isEmpty }
            return stride(from: 0, to: candidates.count, by: 4).map { Array(candidates[$0..<min($0 + 4, candidates.count)]) }
        }
    }
    static func overlappingIdentityIDs(fields: [FormField], kinds: [String: FieldKind]) -> Set<String> {
        func components(_ kind: FieldKind) -> Set<String> {
            switch kind {
            case .family: return ["family"]
            case .given: return ["given"]
            case .fullName: return ["family", "given"]
            case .familyKana: return ["familyKana"]
            case .givenKana: return ["givenKana"]
            case .fullKana: return ["familyKana", "givenKana"]
            case .postal: return ["postalFirst3", "postalLast4"]
            case .postalFirst3: return ["postalFirst3"]
            case .postalLast4: return ["postalLast4"]
            default: return []
            }
        }
        var conflicts = Set<String>()
        for group in fieldGroups(fields) where group.contains(where: { $0.groupID != nil }) {
            for (index, field) in group.enumerated() {
                let parts = components(kinds[field.id] ?? .unknown)
                for sibling in group.dropFirst(index + 1) where !parts.isDisjoint(with: components(kinds[sibling.id] ?? .unknown)) {
                    conflicts.formUnion([field.id, sibling.id])
                }
            }
        }
        return conflicts
    }
    static func modelOutputIssues(ids: [String], kinds: [String], components: [[String]], expectedIDs: [String]) -> [String] {
        var issues = [String]()
        if ids.count != expectedIDs.count { issues.append("count_mismatch") }
        if Set(ids).count != ids.count { issues.append("duplicate_ids") }
        if !Set(ids).subtracting(expectedIDs).isEmpty { issues.append("unexpected_ids") }
        if !Set(expectedIDs).subtracting(ids).isEmpty { issues.append("missing_ids") }
        if kinds.count != ids.count || kinds.contains(where: { !FieldKind.permittedKinds.contains($0) }) { issues.append("invalid_kind") }
        if components.count != ids.count { issues.append("component_count_mismatch") }
        else if kinds.count == ids.count && kinds.allSatisfy({ FieldKind.permittedKinds.contains($0) }) && zip(kinds, components).contains(where: { FieldKind(kind: $0.0, components: $0.1) == nil }) {
            issues.append("invalid_components")
        }
        return issues
    }
    static func safeModelIDs(_ ids: [String]) -> [String] {
        ids.map { $0.range(of: "^f[0-9]{1,2}$", options: .regularExpression) != nil ? $0 : "invalid" }
    }
    static func safeModelKinds(_ kinds: [String]) -> [String] {
        kinds.map { FieldKind.permittedKinds.contains($0) ? $0 : "invalid" }
    }
    // Classification uses metadata only, so occupied fields can be diagnosed too.
    static func fieldsNeedingClassification(_ fields: [FormField], kinds: [String: FieldKind]) -> [FormField] {
        fields.filter { kinds[$0.id] == nil }
    }
    static func decode(_ message: Any?) -> (String, [FormField])? {
        guard let request = message as? [String: Any], request["version"] as? Int == 1,
              ["analyzeForm", "analyzeInline"].contains(request["type"] as? String ?? ""),
              let id = request["requestID"] as? String, UUID(uuidString: id) != nil,
              let raw = request["fields"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), data.count <= 100_000,
              let fields = try? JSONDecoder().decode([FormField].self, from: data), fields.count <= 40,
              Set(fields.map(\.id)).count == fields.count,
              fields.allSatisfy({ field in
                  field.id.range(of: "^f[0-9]{1,2}$", options: .regularExpression) != nil
                  && ["input", "select", "textarea"].contains(field.tag)
                  && (["text", "number", "search", "select-one", "textarea", ""].contains(field.type) || field.type == "tel" && field.isPostalControl)
                  && (field.groupID == nil || field.groupID!.range(of: "^g[0-9]{1,2}$", options: .regularExpression) != nil)
                  && field.maxLength >= 0 && field.maxLength <= 100_000
                  && [field.label, field.ariaLabel, field.name, field.htmlID, field.placeholder, field.autocomplete, field.context, field.pattern].allSatisfy { $0.count <= 120 }
                  && field.options.count <= 60 && field.options.allSatisfy { $0.value.count <= 120 && $0.text.count <= 120 }
              }) else { return nil }
        return (id, fields)
    }

    // No model availability check or inference on the one-step focus path.
    static func analyzeInline(_ message: Any?) -> [String: Any] {
        guard let (requestID, fields) = decode(message) else {
            return ["version": 1, "ok": false, "error": "invalid_request"]
        }
        var kinds = [String: FieldKind]()
        for field in fields { kinds[field.id] = rule(for: field) }
        for (id, kind) in numberedAddressDefaults(fields: fields, kinds: kinds) { kinds[id] = kind }
        kinds = contextualAddressKinds(fields: fields, kinds: kinds)
        var result = plan(fields: fields, kinds: kinds,
                          sources: kinds.mapValues { _ in "rule" }, modelFailed: false, profile: DummyProfile())
        result["requestID"] = requestID
        return result
    }

    static func rule(for field: FormField) -> FieldKind? {
        // Explicit Japanese labels take precedence over sites' imprecise autocomplete hints.
        let label = (field.label + " " + field.ariaLabel).replacingOccurrences(of: "必須", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        // Explicitly unrelated controls must never become address/name targets through inference.
        if field.type == "search" || label.range(of: "電話|メール|email|e-mail|会社|法人|部署|件名|お問い合わせ|お問合せ|検索", options: [.regularExpression, .caseInsensitive]) != nil { return .unknown }
        let autocompleteKind = field.autocomplete.lowercased().split(separator: " ").last.map(String.init) ?? ""
        if ["email", "country", "country-name", "organization", "organization-title"].contains(autocompleteKind)
            || (autocompleteKind.hasPrefix("tel") && !field.isPostalControl) || autocompleteKind.hasPrefix("cc-") { return .unknown }
        if field.isPrefectureSelect { return .address([.prefecture]) }
        let rules: [(String, FieldKind)] = [
            ("^(姓|せい|セイ|姓[（(].*(かな|カナ|ふりがな|フリガナ).*[）)])$", .familyKana),
            ("^(名|めい|メイ|名[（(].*(かな|カナ|ふりがな|フリガナ).*[）)])$", .givenKana)
        ]
        // Kanji-only surname/given name are not kana.
        let kana = field.hint.range(of: "kana|カナ|かな|フリガナ|ふりがな", options: .regularExpression) != nil
        if label == "姓" { return kana ? .familyKana : .family }
        if label == "名" { return kana ? .givenKana : .given }
        if label.range(of: "^(お名前|氏名|フリガナ|ふりがな)[（(]姓[）)]$", options: .regularExpression) != nil { return kana ? .familyKana : .family }
        if label.range(of: "^(お名前|氏名|フリガナ|ふりがな)[（(]名[）)]$", options: .regularExpression) != nil { return kana ? .givenKana : .given }
        for (pattern, kind) in rules where label.range(of: pattern, options: .regularExpression) != nil { return kind }
        // Explicit component lists must not lose a component in model classification.
        if let components = addressRangeComponents(label) { return .address(components) }
        if label.range(of: "(市区町村|市町村).*番地", options: .regularExpression) != nil { return .address([.municipality, .locality, .street]) }
        if label.range(of: "(町名|町域).*番地", options: .regularExpression) != nil { return .address([.locality, .street]) }
        if ["建物名", "マンション名", "アパート名", "方書"].contains(where: label.contains) && !label.contains("番地") { return .address([.building]) }
        if label.contains("都道府県") { return .address([.prefecture]) }
        // Examples need sibling context to determine the intended components;
        // town names need not contain 町 or follow a city+ward pattern.
        if label == "市区町村" && !field.placeholder.isEmpty { return nil }
        let exact: [String: FieldKind] = ["氏名": .fullName, "お名前": .fullName, "姓名": .fullName,
            "フリガナ": .fullKana, "ふりがな": .fullKana, "都道府県": .address([.prefecture]), "市区町村": .address([.municipality]),
            "町名": .address([.locality]), "町域": .address([.locality]), "番地": .address([.street]), "丁目・番地・号": .address([.street]),
            "町名・番地": .address([.locality, .street]), "建物名・部屋番号": .address([.building]), "建物名": .address([.building]),
            "住所全体": .address([.prefecture, .municipality, .locality, .street, .building])]
        if let kind = exact[label] { return kind }
        let token = field.autocomplete.lowercased().split(separator: " ").last.map(String.init) ?? ""
        // Address autocomplete describes a level, not necessarily every component
        // accepted by the control. Let the model interpret examples before fixing
        // a kind from this hint. Explicit component labels above still take priority.
        if ["address-level1", "address-level2", "street-address"].contains(token)
            && !field.placeholder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        let standard: [String: FieldKind] = ["family-name": .family, "given-name": .given, "name": .fullName,
            "address-level1": .address([.prefecture]), "address-level2": .address([.municipality]), "street-address": .address([.municipality, .locality, .street, .building])]
        if let kind = standard[token] { return kind }
        if token == "postal-code" || label == "郵便番号" || field.isPostalControl {
            if field.maxLength == 3 { return .postalFirst3 }
            if field.maxLength == 4 { return .postalLast4 }
            return .postal
        }
        return nil
    }

    static func plan(fields: [FormField], kinds: [String: FieldKind], sources: [String: String], modelFailed: Bool, profile: any ProfileValues) -> [String: Any] {
        let kinds = contextualAddressKinds(fields: fields, kinds: kinds)
        var items = [[String: Any]]()
        var skipped = [[String: Any]]()
        let overlappingIDs = Set(overlappingAddressGroups(fields: fields, kinds: kinds).flatMap { $0.map(\.id) })
        let duplicateIdentityIDs = overlappingIdentityIDs(fields: fields, kinds: kinds)
        for field in fields {
            let kind = kinds[field.id] ?? .unknown
            var reason: String?
            var value = profile.value(for: kind)
            if value?.isEmpty == true { reason = "登録情報が空です" }
            if let value, value.utf16.count > 300 { reason = "入力値が長すぎます" }
            if value == nil { reason = "項目を判定できません" }
            if var composed = value {
                if [FieldKind.familyKana, .givenKana, .fullKana].contains(kind), field.hint.contains("ひらがな") || field.hint.contains("ふりがな") || field.hint.contains("せい") || field.hint.contains("めい") {
                    composed = composed.applyingTransform(.hiraganaToKatakana, reverse: true) ?? composed
                }
                if kind == .postal && field.type != "number" && field.type != "tel" && field.maxLength != 7 && !field.hint.contains("ハイフンなし") && !field.hint.contains("ハイフン不要") && field.pattern.isEmpty {
                    composed = String(profile.postal.prefix(3)) + "-" + profile.postal.suffix(4)
                }
                if field.hint.contains("スペースなし") || field.hint.contains("空白なし") { composed = composed.replacingOccurrences(of: " ", with: "") }
                if field.tag == "select" {
                    let matches = field.options.filter { !$0.disabled && !$0.value.isEmpty && ($0.text.trimmingCharacters(in: .whitespacesAndNewlines) == composed || $0.value == composed) }
                    if matches.count == 1 { composed = matches[0].value }
                    else { reason = "一致する選択肢がありません" }
                } else if field.maxLength > 0 && composed.utf16.count > field.maxLength { reason = "文字数制限に合いません" }
                // Conservative preflight; the content script also checks the browser's HTML pattern semantics.
                if field.tag != "select" && !field.pattern.isEmpty {
                    if let regex = try? NSRegularExpression(pattern: "^(?:" + field.pattern + ")$") {
                        func matches(_ string: String) -> Bool { regex.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)) != nil }
                        let hyphenated = String(profile.postal.prefix(3)) + "-" + profile.postal.suffix(4)
                        if !matches(composed) && kind == .postal && field.type != "number" && matches(hyphenated) { composed = hyphenated }
                        if !matches(composed) { reason = "入力形式の制約に合いません" }
                    } else { reason = "入力形式の制約に合いません" }
                }
                if field.tag != "select" && field.maxLength > 0 && composed.utf16.count > field.maxLength { reason = "文字数制限に合いません" }
                if field.type == "number" && Double(composed) == nil { reason = "数値欄の制約に合いません" }
                value = composed
            }
            if duplicateIdentityIDs.contains(field.id) { reason = "グループ内の入力内容が重複しています" }
            if overlappingIDs.contains(field.id) { reason = "住所欄の構成が重複しています" }
            if let reason {
                skipped.append(["id": field.id, "label": field.displayLabel, "reason": reason,
                                "kind": kind.rawValue, "components": kind.components.map(\.rawValue), "source": sources[field.id] ?? "unclassified"])
                continue
            }
            items.append(["id": field.id, "label": field.displayLabel, "kind": kind.rawValue, "components": kind.components.map(\.rawValue), "value": value!, "displayValue": field.tag == "select" ? profile.prefecture : value!, "source": sources[field.id] ?? "model", "overwritesExisting": field.occupied])
        }
        return ["version": 1, "ok": true, "profileID": profile.id, "items": items, "skipped": skipped, "modelFailed": modelFailed]
    }
}
