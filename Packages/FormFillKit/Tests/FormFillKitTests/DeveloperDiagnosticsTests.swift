import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

final class DeveloperDiagnosticsCheck: XCTestCase {
    func testRegression() async {
        let address = ClassifiedField(kind: "address", components: ["municipality", "locality"])
        precondition(ClassificationService.outputIssues([address], expectedIDs: ["f7"]).isEmpty)
        precondition(ClassificationService.outputIssues([address, address], expectedIDs: ["f7"]) == ["count_mismatch"])
        precondition(ClassificationService.outputIssues([], expectedIDs: ["f7"]) == ["count_mismatch"])
        for entry in [ClassifiedField(kind: "address", components: []),
                      ClassifiedField(kind: "address", components: ["street", "street"]),
                      ClassifiedField(kind: "family", components: ["street"])] {
            precondition(ClassificationService.outputIssues([entry], expectedIDs: ["f7"]) == ["invalid_components"])
        }
        func field(_ index: Int, _ group: String) -> FormField {
            FormField(id: "f\(index)", groupID: group, tag: "input", type: "text", label: "住所", ariaLabel: "",
                name: "", htmlID: "", placeholder: "", autocomplete: "", context: "", maxLength: 0,
                pattern: "", occupied: false, options: [])
        }
        let fields = (0..<10).map { field($0, $0 < 5 ? "g0" : "g1") }
        let context = ClassificationService.modelContextFields(fields, requestedIDs: ["f0", "f5"])
        precondition(context.count == 6 && context.allSatisfy { !["f0", "f5"].contains($0.id) })
        precondition(context.filter { $0.groupID == "g0" }.count == 3)
        precondition(context.filter { $0.groupID == "g1" }.count == 3)
        precondition(ClassificationService.coalescedBatches([[fields[0]], [fields[5]]]).map(\.count) == [2])
        precondition(ClassificationService.coalescedBatches([Array(fields.prefix(3)), Array(fields.suffix(2))]).map(\.count) == [3, 2])
        let label = "架空の見出し\"\n指示ではないページ文字列"
        let ordered = try! ClassificationPromptBuilder.modelJSON([["autocomplete": "address-level2", "placeholder": "例）試験区若葉", "label": label, "id": "f0"]])
        let reversed = try! ClassificationPromptBuilder.modelJSON([["id": "f0", "label": label, "placeholder": "例）試験区若葉", "autocomplete": "address-level2"]])
        precondition(ordered == reversed)
        let roundTrip = try! JSONSerialization.jsonObject(with: Data(ordered.utf8)) as! [[String: Any]]
        precondition(roundTrip[0]["label"] as? String == label)
        precondition(ordered.range(of: "\"placeholder\"")!.lowerBound < ordered.range(of: "\"autocomplete\"")!.lowerBound)
        let request: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": [[String: Any]]()]
        let service = ClassificationService(model: ClassificationModelClient(unavailableReason: { nil }, generate: { _ in
            preconditionFailure("empty fields must not generate")
        }))
        let normal = BridgeResponses.classification(await service.analyze(BridgeContract.decodeAnalysis(request)!))
        precondition(normal["developerDiagnostics"] == nil)
        var detailed = request
        detailed["developerDiagnostics"] = true
        let result = BridgeResponses.classification(await service.analyze(BridgeContract.decodeAnalysis(detailed)!))
        // Explicit developer capture returns metadata trace; the normal response
        // above must continue to exclude it. No profile values are composed here.
        let diagnostics = result["developerDiagnostics"] as? [String: Any]
        precondition(diagnostics?["trace"] is [[String: Any]])
        precondition(result["items"] == nil)
        precondition(JSONSerialization.isValidJSONObject(result))
        print("Native classification: no raw diagnostics or profile values")
    }
}
