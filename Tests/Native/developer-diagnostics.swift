import Foundation

@main struct DeveloperDiagnosticsCheck {
    static func main() async {
        let request: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": [[String: Any]]()]
        let normal = await FormClassifier.analyze(request)
        precondition(normal["developerDiagnostics"] == nil)
        var detailed = request
        detailed["developerDiagnostics"] = true
        let result = await FormClassifier.analyze(detailed)
        precondition(result["developerDiagnostics"] == nil)
        precondition(result["items"] == nil)
        precondition(JSONSerialization.isValidJSONObject(result))
        print("Native classification: no raw diagnostics or profile values")
    }
}
