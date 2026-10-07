import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

final class RouterCounters {
    var saves = 0
    var probes = 0
    var auth = 0
    var error: Error?
}
final class RouterAuthorization: FillAuthorization {
    func loadProfile() async throws -> Profile { throw ProfileError.authentication }
    func cancel() {}
}

final class NativeRouterTests: XCTestCase {
    func check(_ condition: Bool) { precondition(condition) }
    func testRegression() async throws {
        let counters = RouterCounters()
        let model = ClassificationModelClient(unavailableReason: { nil }, generate: { _ in preconditionFailure("rules require no model") })
        let router = NativeMessageRouter(classifier: ClassificationService(model: model),
            fills: ProfileFillService(authorize: { _ in counters.auth += 1; return RouterAuthorization() }),
            saveReport: { _ in counters.saves += 1; if let error = counters.error { throw error } },
            probeModel: { counters.probes += 1; return ["ok": true] })
        check((await router.handle(["version": 1, "type": "health"]))["ok"] as? Bool == true)
        _ = await router.handle(["version": 1, "type": "modelProbe"])
        check(counters.probes == 1)
        check((await router.handle(["version": 1, "type": "analyzeInline"]))["error"] as? String == "unsupported_request")
        let field = FormField(id: "f0", tag: "input", type: "text", label: "姓", ariaLabel: "", name: "", htmlID: "", placeholder: "", autocomplete: "family-name", context: "", maxLength: 0, pattern: "", occupied: false, options: [])
        let fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode([field]))
        var request: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "tabID": 7, "origin": "https://example.test", "fields": fields]
        let classification = await router.handle(request)
        check(classification["items"] == nil && classification["sessionID"] is String)
        check(counters.auth == 0)
        request["type"] = "quickFill"; request["sessionID"] = classification["sessionID"]
        let denied = await router.handle(request)
        check(denied["error"] as? String == "authentication_failed" && denied["items"] == nil)
        check(counters.auth == 1)
        check((await router.handle(request))["error"] as? String == "stale_plan")
        let report: [String: Any] = ["version": 1, "type": "saveDeveloperReport", "report": "{}"]
        for (error, code) in [(DeveloperReportError.tooLarge as Error, "report_too_large"),
                              (ProfileError.authentication as Error, "authentication_failed"),
                              (DeveloperReportError.invalidReport as Error, "report_save_failed")] {
            counters.error = error
            check((await router.handle(report))["error"] as? String == code)
        }
        counters.error = nil
        check((await router.handle(report))["ok"] as? Bool == true && counters.saves == 4)
        print("Native router: dispatch, metadata-only classification, auth denial, consume and report error mapping passed")
    }
}
