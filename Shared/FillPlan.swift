import Foundation

struct FormField: Codable {
    struct Option: Codable { let value: String; let text: String; let disabled: Bool }
    let id: String
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
    var isPostalControl: Bool { autocomplete.split(separator: " ").contains("postal-code") || (name + " " + htmlID).range(of: "zip|postal|postcode|郵便番号", options: [.regularExpression, .caseInsensitive]) != nil }
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

enum FieldKind: String, Codable, CaseIterable {
    case family, given, fullName, familyKana, givenKana, fullKana
    case postal, postalFirst3, postalLast4
    case prefecture, prefectureMunicipality, municipality, locality, street, building
    case localityStreet, municipalityLocality, municipalityLocalityStreet, addressWithoutPrefecture, fullAddress, unknown
}

// Synthetic data only. The classifier never receives this profile.
struct DummyProfile {
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
        case .prefecture: return prefecture
        case .prefectureMunicipality: return prefecture + municipality
        case .municipality: return municipality
        case .locality: return locality
        case .street: return street
        case .building: return building
        case .localityStreet: return locality + street
        case .municipalityLocality: return municipality + locality
        case .municipalityLocalityStreet: return municipality + locality + street
        case .addressWithoutPrefecture: return municipality + locality + street + " " + building
        case .fullAddress: return prefecture + municipality + locality + street + " " + building
        case .unknown: return nil
        }
    }
}

enum FillPlanner {
    static func numberedAddressGroups(_ fields: [FormField]) -> [[FormField]] {
        var groups = [[FormField]]()
        var current = [FormField]()
        for field in fields {
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
            // Region controls without DOM group IDs could belong to this group.
            // Leave such layouts to explicit rules/model context rather than assume.
            guard !fields.contains(where: { !ids.contains($0.id) && !addressComponents(kinds[$0.id] ?? .unknown).isEmpty }) else { continue }
            defaults[group[0].id] = .prefectureMunicipality
            defaults[group[1].id] = .localityStreet
            defaults[group[2].id] = .building
        }
        return defaults
    }
    static func addressComponents(_ kind: FieldKind) -> Set<String> {
        switch kind {
        case .prefecture: return ["prefecture"]
        case .prefectureMunicipality: return ["prefecture", "municipality"]
        case .municipality: return ["municipality"]
        case .locality: return ["locality"]
        case .street: return ["street"]
        case .building: return ["building"]
        case .localityStreet: return ["locality", "street"]
        case .municipalityLocality: return ["municipality", "locality"]
        case .municipalityLocalityStreet: return ["municipality", "locality", "street"]
        case .addressWithoutPrefecture: return ["municipality", "locality", "street", "building"]
        case .fullAddress: return ["prefecture", "municipality", "locality", "street", "building"]
        default: return []
        }
    }
    static func overlappingAddressGroups(fields: [FormField], kinds: [String: FieldKind]) -> [[FormField]] {
        numberedAddressGroups(fields).filter { group in
            var seen = Set<String>()
            for field in group {
                let components = addressComponents(kinds[field.id] ?? .unknown)
                if !seen.isDisjoint(with: components) { return true }
                seen.formUnion(components)
            }
            return false
        }
    }
    static func modelOutputIssues(ids: [String], kinds: [String], expectedIDs: [String]) -> [String] {
        var issues = [String]()
        if ids.count != expectedIDs.count { issues.append("count_mismatch") }
        if Set(ids).count != ids.count { issues.append("duplicate_ids") }
        if !Set(ids).subtracting(expectedIDs).isEmpty { issues.append("unexpected_ids") }
        if !Set(expectedIDs).subtracting(ids).isEmpty { issues.append("missing_ids") }
        if kinds.count != ids.count || kinds.contains(where: { FieldKind(rawValue: $0) == nil }) { issues.append("invalid_kind") }
        return issues
    }
    static func safeModelIDs(_ ids: [String]) -> [String] {
        ids.map { $0.range(of: "^f[0-9]{1,2}$", options: .regularExpression) != nil ? $0 : "invalid" }
    }
    static func safeModelKinds(_ kinds: [String]) -> [String] {
        kinds.map { FieldKind(rawValue: $0)?.rawValue ?? "invalid" }
    }
    // Classification uses metadata only, so occupied fields can be diagnosed too.
    static func fieldsNeedingClassification(_ fields: [FormField], kinds: [String: FieldKind]) -> [FormField] {
        fields.filter { kinds[$0.id] == nil }
    }
    static func decode(_ message: Any?) -> (String, [FormField])? {
        guard let request = message as? [String: Any], request["version"] as? Int == 1,
              request["type"] as? String == "analyzeForm",
              let id = request["requestID"] as? String, UUID(uuidString: id) != nil,
              let raw = request["fields"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), data.count <= 100_000,
              let fields = try? JSONDecoder().decode([FormField].self, from: data), fields.count <= 40,
              Set(fields.map(\.id)).count == fields.count,
              fields.allSatisfy({ field in
                  field.id.range(of: "^f[0-9]{1,2}$", options: .regularExpression) != nil
                  && ["input", "select", "textarea"].contains(field.tag)
                  && (["text", "number", "search", "select-one", "textarea", ""].contains(field.type) || field.type == "tel" && field.isPostalControl)
                  && field.maxLength >= 0 && field.maxLength <= 100_000
                  && [field.label, field.ariaLabel, field.name, field.htmlID, field.placeholder, field.autocomplete, field.context, field.pattern].allSatisfy { $0.count <= 120 }
                  && field.options.count <= 60 && field.options.allSatisfy { $0.value.count <= 120 && $0.text.count <= 120 }
              }) else { return nil }
        return (id, fields)
    }

    static func rule(for field: FormField) -> FieldKind? {
        // Explicit Japanese labels take precedence over sites' imprecise autocomplete hints.
        let label = (field.label + " " + field.ariaLabel).replacingOccurrences(of: "必須", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        // Explicitly unrelated controls must never become address/name targets through inference.
        if field.type == "search" || label.range(of: "電話|メール|email|e-mail|会社|法人|部署|件名|お問い合わせ|お問合せ|検索", options: [.regularExpression, .caseInsensitive]) != nil { return .unknown }
        if field.isPrefectureSelect { return .prefecture }
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
        if label.range(of: "(市区町村郡|市区町村|市町村)以降", options: .regularExpression) != nil { return .addressWithoutPrefecture }
        if label.range(of: "(市区町村|市町村).*番地", options: .regularExpression) != nil { return .municipalityLocalityStreet }
        if label.range(of: "(町名|町域).*番地", options: .regularExpression) != nil { return .localityStreet }
        if label.contains("建物名") && !label.contains("番地") { return .building }
        if label.contains("都道府県") { return .prefecture }
        // Some city-labelled fields explicitly show a city, ward and town in their example.
        if label == "市区町村" && field.placeholder.range(of: "市.+区.+(町|丁目)", options: .regularExpression) != nil { return .municipalityLocality }
        // Other examples need sibling context to determine the intended components.
        if label == "市区町村" && !field.placeholder.isEmpty { return nil }
        let exact: [String: FieldKind] = ["氏名": .fullName, "お名前": .fullName, "姓名": .fullName,
            "フリガナ": .fullKana, "ふりがな": .fullKana, "都道府県": .prefecture, "市区町村": .municipality,
            "町名": .locality, "町域": .locality, "番地": .street, "丁目・番地・号": .street,
            "町名・番地": .localityStreet, "建物名・部屋番号": .building, "建物名": .building,
            "住所全体": .fullAddress]
        if let kind = exact[label] { return kind }
        let token = field.autocomplete.lowercased().split(separator: " ").last.map(String.init) ?? ""
        let standard: [String: FieldKind] = ["family-name": .family, "given-name": .given, "name": .fullName,
            "address-level1": .prefecture, "address-level2": .municipality, "street-address": .addressWithoutPrefecture]
        if let kind = standard[token] { return kind }
        if token == "postal-code" || label == "郵便番号" || field.isPostalControl {
            if field.maxLength == 3 { return .postalFirst3 }
            if field.maxLength == 4 { return .postalLast4 }
            return .postal
        }
        return nil
    }

    static func plan(fields: [FormField], kinds: [String: FieldKind], sources: [String: String], modelFailed: Bool) -> [String: Any] {
        let profile = DummyProfile()
        var items = [[String: Any]]()
        var skipped = [[String: String]]()
        let overlappingIDs = Set(overlappingAddressGroups(fields: fields, kinds: kinds).flatMap { $0.map(\.id) })
        for field in fields {
            let kind = kinds[field.id] ?? .unknown
            var reason: String?
            var value = profile.value(for: kind)
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
            if overlappingIDs.contains(field.id) { reason = "住所欄の構成が重複しています" }
            if let reason {
                skipped.append(["id": field.id, "label": field.displayLabel, "reason": reason,
                                "kind": kind.rawValue, "source": sources[field.id] ?? "unclassified"])
                continue
            }
            items.append(["id": field.id, "label": field.displayLabel, "kind": kind.rawValue, "value": value!, "displayValue": field.tag == "select" ? profile.prefecture : value!, "source": sources[field.id] ?? "model", "overwritesExisting": field.occupied])
        }
        return ["version": 1, "ok": true, "profileID": profile.id, "items": items, "skipped": skipped, "modelFailed": modelFailed]
    }
}
