import Foundation

/// Pure classification and value composition; no transport or platform dependencies.
public enum FillPlanner {
    public static func plan(fields: [FormField], kinds: [String: FieldKind], sources: [String: String], modelFailed: Bool, profile: any ProfileValues) -> FillPlan {
        let kinds = contextualAddressKinds(fields: fields, kinds: kinds)
        var items = [FillItem]()
        var skipped = [SkippedField]()
        let overlappingIDs = Set(overlappingAddressGroups(fields: fields, kinds: kinds).flatMap { $0.map(\.id) })
        let duplicateIdentityIDs = overlappingIdentityIDs(fields: fields, kinds: kinds)
        for field in fields {
            let kind = kinds[field.id] ?? .unknown
            var reason: SkipReason?
            var value = profile.value(for: kind)
            if value?.isEmpty == true { reason = .emptyProfile }
            if let value, value.utf16.count > 300 { reason = .valueTooLong }
            if value == nil { reason = .unclassified }
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
                    else { reason = .noMatchingOption }
                } else if field.maxLength > 0 && composed.utf16.count > field.maxLength { reason = .lengthConstraint }
                // Conservative preflight; the content script also checks the browser's HTML pattern semantics.
                if field.tag != "select" && !field.pattern.isEmpty {
                    if let regex = try? NSRegularExpression(pattern: "^(?:" + field.pattern + ")$") {
                        func matches(_ string: String) -> Bool { regex.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)) != nil }
                        let hyphenated = String(profile.postal.prefix(3)) + "-" + profile.postal.suffix(4)
                        if !matches(composed) && kind == .postal && field.type != "number" && matches(hyphenated) { composed = hyphenated }
                        if !matches(composed) { reason = .patternConstraint }
                    } else { reason = .patternConstraint }
                }
                if field.tag != "select" && field.maxLength > 0 && composed.utf16.count > field.maxLength { reason = .lengthConstraint }
                if field.type == "number" && Double(composed) == nil { reason = .numberConstraint }
                value = composed
            }
            if duplicateIdentityIDs.contains(field.id) { reason = .groupOverlap }
            if overlappingIDs.contains(field.id) { reason = .addressOverlap }
            if let reason {
                skipped.append(SkippedField(id: field.id, label: field.displayLabel, reason: reason,
                    kind: kind, source: sources[field.id] ?? "unclassified"))
                continue
            }
            items.append(FillItem(id: field.id, label: field.displayLabel, kind: kind, value: value!,
                displayValue: field.tag == "select" ? profile.prefecture : value!,
                source: sources[field.id] ?? "model", overwritesExisting: field.occupied))
        }
        return FillPlan(profileID: profile.id, items: items, skipped: skipped, modelFailed: modelFailed)
    }
}
