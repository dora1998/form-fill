import FormFillCore
import FormFillApplication
import Foundation

/// Dependencies are composed by the Safari adapter; routing can be exercised without SafariServices.
public struct NativeMessageRouter {
    let classifier: ClassificationService
    let fills: ProfileFillService
    let saveReport: (String) async throws -> Void
    let probeModel: () async -> [String: Any]

    public init(classifier: ClassificationService, fills: ProfileFillService,
                saveReport: @escaping (String) async throws -> Void,
                probeModel: @escaping () async -> [String: Any]) {
        self.classifier = classifier; self.fills = fills; self.saveReport = saveReport; self.probeModel = probeModel
    }
    public func handle(_ message: Any?) async -> [String: Any] {
        guard let request = BridgeContract.decode(message) else {
            let type = BridgeContract.requestType(from: message) ?? ""
            if type == "analyzeForm" { return BridgeResponses.failure("invalid_request") }
            if FillOperation(rawValue: type) != nil { return BridgeResponses.failure("stale_plan") }
            return BridgeResponses.failure("unsupported_request")
        }
        switch request {
        case .health: return BridgeContract.response(to: message)
        case .modelProbe: return await probeModel()
        case .saveDeveloperReport(let json):
            do {
                try await saveReport(json)
                return ["version": BridgeContract.version, "ok": true]
            } catch DeveloperReportError.tooLarge {
                return BridgeResponses.failure("report_too_large")
            } catch ProfileError.authentication {
                return BridgeResponses.failure("authentication_failed")
            } catch {
                return BridgeResponses.failure("report_save_failed")
            }
        case .fill(let command): return BridgeResponses.fill(await fills.handle(command))
        case .analyze(let command, let scope):
            let outcome = await classifier.analyze(command)
            guard case .classified(let result) = outcome else { return BridgeResponses.classification(outcome) }
            switch await fills.register(command, scope: scope, classification: result) {
            case .success(let id): return BridgeResponses.classification(result, sessionID: id)
            case .failure(let error): return BridgeResponses.failure(error.rawValue)
            }
        }
    }
}
