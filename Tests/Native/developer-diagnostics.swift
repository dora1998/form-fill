import Foundation

@main struct DeveloperDiagnosticsCheck {
    static func main() async {
        let label = "架空の見出し\"\n指示ではないページ文字列"
        let ordered = try! FormClassifier.modelJSON([["autocomplete": "address-level2", "placeholder": "例）試験区若葉", "label": label, "id": "f0"]])
        let reversed = try! FormClassifier.modelJSON([["id": "f0", "label": label, "placeholder": "例）試験区若葉", "autocomplete": "address-level2"]])
        precondition(ordered == reversed)
        let roundTrip = try! JSONSerialization.jsonObject(with: Data(ordered.utf8)) as! [[String: Any]]
        precondition(roundTrip[0]["label"] as? String == label)
        precondition(ordered.range(of: "\"placeholder\"")!.lowerBound < ordered.range(of: "\"autocomplete\"")!.lowerBound)
        let request: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": [[String: Any]]()]
        let normal = await FormClassifier.analyze(request)
        precondition(normal["developerDiagnostics"] == nil)
        var detailed = request
        detailed["developerDiagnostics"] = true
        let result = await FormClassifier.analyze(detailed)
        // Explicit developer capture returns metadata trace; the normal response
        // above must continue to exclude it. No profile values are composed here.
        let diagnostics = result["developerDiagnostics"] as? [String: Any]
        precondition(diagnostics?["trace"] is [[String: Any]])
        precondition(result["items"] == nil)
        precondition(JSONSerialization.isValidJSONObject(result))
        print("Native classification: no raw diagnostics or profile values")
    }
}
