import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

final class ModelScript {
    var prompts = [ClassificationPrompt]()
    var responses: [Result<[ClassifiedField], ClassificationModelFailure>]
    var clock: TimeInterval = 0
    var advance: TimeInterval = 0
    init(_ responses: [Result<[ClassifiedField], ClassificationModelFailure>]) { self.responses = responses }
    var client: ClassificationModelClient {
        ClassificationModelClient(unavailableReason: { nil }, generate: { request in
            self.prompts.append(request)
            self.clock += self.advance
            let fields = try self.responses.removeFirst().get()
            return ClassificationModelResponse(fields: fields, diagnosticJSON: "synthetic response")
        })
    }
}

final class ClassificationServiceTests: XCTestCase {
    func field(_ id: Int, label: String = "住所詳細", group: String = "g0") -> FormField {
        FormField(id: "f\(id)", groupID: group, tag: "input", type: "text", label: label, ariaLabel: "", name: "", htmlID: "", placeholder: "例）試験区若葉", autocomplete: "", context: "", maxLength: 0, pattern: "", occupied: false, options: [])
    }
    func result(_ outcome: ClassificationOutcome) -> ClassificationResult {
        guard case .classified(let value) = outcome else { preconditionFailure("expected classification") }
        return value
    }
    func testRegression() async {
        let unknown = ClassifiedField(kind: "unknown", components: [])
        let ruleScript = ModelScript([])
        let rule = result(await ClassificationService(model: ruleScript.client).analyze(
            AnalyzeCommand(requestID: "rules", fields: [field(0, label: "姓")])) )
        precondition(rule.fields[0].kind == .family && ruleScript.prompts.isEmpty)
        precondition(rule.developerDiagnostics == nil)

        let unavailable = ClassificationService(model: ClassificationModelClient(unavailableReason: { "model_not_ready" }, generate: { _ in preconditionFailure("unavailable model invoked") }))
        if case .unavailable(let reason, let diagnostics) = await unavailable.analyze(AnalyzeCommand(requestID: "unavailable", fields: [], developerDiagnostics: true)) {
            precondition(reason == "model_not_ready" && diagnostics != nil)
        } else { preconditionFailure("availability lost") }

        let invalid = ModelScript([.success([unknown]), .success([unknown])])
        let invalidResult = result(await ClassificationService(model: invalid.client).analyze(
            AnalyzeCommand(requestID: "invalid", fields: (0..<5).map { field($0) })))
        precondition(invalidResult.modelFailed && invalidResult.attemptedBatches == 2)
        precondition(invalidResult.failures[0]["validationCodes"] as? [String] == ["count_mismatch"])
        precondition(invalid.prompts.map { $0.ids.count } == [4, 1])
        precondition(invalidResult.fields.count == 5)

        let failed = ModelScript([.failure(ClassificationModelFailure(code: "rate_limited", diagnosticDescription: "synthetic detail")), .success([unknown])])
        let failedResult = result(await ClassificationService(model: failed.client).analyze(
            AnalyzeCommand(requestID: "failure", fields: (0..<5).map { field($0) })))
        precondition(failedResult.failures[0]["reason"] as? String == "rate_limited")
        precondition(failedResult.attemptedBatches == 2 && failedResult.fields[4].source == "model")

        let deadline = ModelScript([.success(Array(repeating: unknown, count: 4))])
        deadline.advance = 46
        let deadlineResult = result(await ClassificationService(model: deadline.client, now: { deadline.clock }).analyze(
            AnalyzeCommand(requestID: "deadline", fields: (0..<5).map { field($0) })))
        precondition(deadlineResult.attemptedBatches == 1 && deadline.prompts.count == 1)
        precondition(deadlineResult.failures.last?["reason"] as? String == "deadline_exceeded")
        precondition(deadlineResult.failures.last?["fieldIDs"] as? [String] == ["f4"])

        let partial = ClassifiedField(kind: "address", components: ["municipality", "locality"])
        let complete = ClassifiedField(kind: "address", components: ["municipality", "locality", "street"])
        let review = ModelScript([.success([partial]), .success([complete])])
        let reviewed = result(await ClassificationService(model: review.client).analyze(
            AnalyzeCommand(requestID: "review", fields: [field(0)], developerDiagnostics: true)))
        precondition(reviewed.reviewedBatches == 1 && reviewed.fields[0].kind == .address([.municipality, .locality, .street]))
        precondition(review.prompts[1].prompt.hasPrefix("Review the provisional allocation:"))
        let rejected = ModelScript([.success([partial]), .success([ClassifiedField(kind: "address", components: ["street"])])])
        let rejection = result(await ClassificationService(model: rejected.client).analyze(
            AnalyzeCommand(requestID: "rejected", fields: [field(0)], developerDiagnostics: true)))
        precondition(rejection.fields[0].kind == .address([.municipality, .locality]))
        let trace = rejection.developerDiagnostics?["trace"] as! [[String: Any]]
        precondition(trace.contains { $0["stage"] as? String == "address_review_rejected" })
        print("Classification service: rule-only, unavailable, malformed output, partial failure, deadline, bounded review and rejected review passed")
    }

    func testDecodeFailureRawResponseRequiresDeveloperCapture() async throws {
        let raw = "synthetic-invalid-model-response"
        let detail = "synthetic-sdk-decoding-detail"
        for detailed in [false, true] {
            let script = ModelScript([.failure(ClassificationModelFailure(
                code: "decoding_failure", diagnosticDescription: detail, rawResponse: raw))])
            let outcome = await ClassificationService(model: script.client).analyze(
                AnalyzeCommand(requestID: "decode-failure", fields: [field(0)], developerDiagnostics: detailed))
            let value = result(outcome)
            XCTAssertEqual(value.failures.first?["reason"] as? String, "decoding_failure")
            XCTAssertTrue(value.modelFailed)
            let wire = BridgeResponses.classification(outcome)
            let json = String(decoding: try JSONSerialization.data(withJSONObject: wire), as: UTF8.self)
            if detailed {
                let trace = try XCTUnwrap(value.developerDiagnostics?["trace"] as? [[String: Any]])
                let responseIndex = try XCTUnwrap(trace.firstIndex { $0["stage"] as? String == "model_response" })
                let errorIndex = try XCTUnwrap(trace.firstIndex { $0["stage"] as? String == "model_error" })
                XCTAssertLessThan(responseIndex, errorIndex)
                XCTAssertEqual(trace[responseIndex]["response"] as? String, raw)
                XCTAssertTrue(json.contains(raw))
            } else {
                XCTAssertNil(value.developerDiagnostics)
                XCTAssertNil(wire["developerDiagnostics"])
                XCTAssertFalse(json.contains(raw))
                XCTAssertFalse(json.contains(detail))
            }
        }
    }

}
