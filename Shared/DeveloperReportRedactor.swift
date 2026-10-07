import Foundation

/// Best-effort masking of the current registered profile, not general anonymization.
/// Only the masked result may cross the persistent report-store boundary.
enum DeveloperReportRedactor {
    static func redact(_ json: String, profile: Profile?) throws -> String {
        guard json.utf8.count <= DebugReportStore.maximumBytes else { throw DebugReportStore.StoreError.tooLarge }
        guard var report = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              report["schemaVersion"] as? Int == 1,
              report["product"] as? String == "Form Fill developer diagnostics" else {
            throw DebugReportStore.StoreError.invalidReport
        }
        var tokens = Set<String>()
        if let p = profile {
            let values = [p.family, p.given, p.familyKana, p.givenKana, p.postal, p.prefecture,
                          p.municipality, p.locality, p.street, p.building]
                + FieldKind.allCases.compactMap { p.value(for: $0) }
            for value in values where !value.isEmpty {
                var variants = Set([value, value.replacingOccurrences(of: " ", with: ""),
                                    value.replacingOccurrences(of: " ", with: "　")])
                for v in Array(variants) {
                    variants.insert(v.precomposedStringWithCompatibilityMapping)
                    if let converted = v.applyingTransform(.hiraganaToKatakana, reverse: true) { variants.insert(converted) }
                    if let converted = v.applyingTransform(.fullwidthToHalfwidth, reverse: true) { variants.insert(converted) }
                    if let converted = v.applyingTransform(.fullwidthToHalfwidth, reverse: false) { variants.insert(converted) }
                }
                for v in variants where !v.isEmpty {
                    tokens.insert(v)
                    tokens.insert(v.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? v)
                    tokens.insert(v.unicodeScalars.map { String(format: "&#%d;", $0.value) }.joined())
                    tokens.insert(v.unicodeScalars.map { String(format: "&#x%x;", $0.value) }.joined())
                    tokens.insert(v.utf16.map { String(format: "\\u%04x", $0) }.joined())
                    tokens.insert(v.replacingOccurrences(of: "&", with: "&amp;")
                        .replacingOccurrences(of: "\"", with: "&quot;")
                        .replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;"))
                }
            }
        }
        let alternatives = tokens.sorted { $0.count > $1.count }.map { value -> String in
            let escaped = NSRegularExpression.escapedPattern(for: value)
            // Do not replace a postal fragment inside a longer numeric identifier.
            return value.allSatisfy({ $0.isASCII && $0.isNumber }) ? "(?<![0-9])" + escaped + "(?![0-9])" : escaped
        }
        let regex = alternatives.isEmpty ? nil : try NSRegularExpression(pattern: alternatives.joined(separator: "|"), options: .caseInsensitive)
        func mask(_ value: String) -> String {
            regex?.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "[PROFILE]") ?? value
        }
        func walk(_ value: Any) -> Any {
            if let text = value as? String { return mask(text) }
            if let array = value as? [Any] { return array.map(walk) }
            if let object = value as? [String: Any] {
                var result = [String: Any]()
                for (key, value) in object {
                    var safeKey = mask(key)
                    while result[safeKey] != nil { safeKey += "_" }
                    result[safeKey] = walk(value)
                }
                return result
            }
            return value
        }
        report = walk(report) as! [String: Any]
        // Keep envelope keys stable even when a profile resembles a schema keyword.
        report["schemaVersion"] = 1
        report["product"] = "Form Fill developer diagnostics"
        report["profileMasking"] = ["version": 1, "currentProfilePresent": profile != nil,
            "scope": "Current registered profile and common composed/encoded variants only; other personal data and embedded credentials may remain."] as [String: Any]
        return String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
    }
}
