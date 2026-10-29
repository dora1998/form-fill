import Foundation

public extension FillPlanner {
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
    // Classification uses metadata only, so occupied fields can be diagnosed too.
    static func fieldsNeedingClassification(_ fields: [FormField], kinds: [String: FieldKind]) -> [FormField] {
        fields.filter { kinds[$0.id] == nil }
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

}
