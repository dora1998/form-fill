import Foundation

@main struct DeveloperDiagnosticsCheck {
    static func main() async {
        let request: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": [[String: Any]]()]
        let normal = await FormClassifier.analyze(request)
        precondition(normal["developerDiagnostics"] == nil)
        var detailed = request
        detailed["developerDiagnostics"] = true
        let result = await FormClassifier.analyze(detailed)
        let diagnostics = result["developerDiagnostics"] as? [String: Any]
        precondition(diagnostics != nil)
        precondition((diagnostics?["trace"] as? [[String: Any]])?.isEmpty == false)
        precondition(JSONSerialization.isValidJSONObject(result))
        print("Native development trace: explicit opt-in, normal exclusion, serialization passed")
    }
}
