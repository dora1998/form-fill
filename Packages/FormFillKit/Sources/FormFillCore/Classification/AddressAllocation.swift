import Foundation

public extension FillPlanner {
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
}
