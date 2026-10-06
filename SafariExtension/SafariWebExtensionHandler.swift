import FoundationModels
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let response = NSExtensionItem()
        let message = item?.userInfo?[SFExtensionMessageKey]

        if BridgeContract.requestType(from: message) == "saveDeveloperReport" {
            response.userInfo = [SFExtensionMessageKey: saveDeveloperReport(message)]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        } else if BridgeContract.requestType(from: message) == "analyzeInline" {
            response.userInfo = [SFExtensionMessageKey: FillPlanner.analyzeInline(message)]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        } else if BridgeContract.requestType(from: message) == "analyzeForm" {
            Task {
                response.userInfo = [SFExtensionMessageKey: await FormClassifier.analyze(message)]
                context.completeRequest(returningItems: [response], completionHandler: nil)
            }
        } else if BridgeContract.requestType(from: message) == "modelProbe" {
            Task {
                response.userInfo = [SFExtensionMessageKey: await modelProbeResponse(to: message)]
                context.completeRequest(returningItems: [response], completionHandler: nil)
            }
        } else {
            response.userInfo = [SFExtensionMessageKey: BridgeContract.response(to: message)]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    private func saveDeveloperReport(_ message: Any?) -> [String: Any] {
        guard let request = message as? [String: Any], request["version"] as? Int == BridgeContract.version,
              let json = request["report"] as? String else {
            return ["version": 1, "ok": false, "error": "invalid_request"]
        }
        do {
            let url = try DebugReportStore.shared().save(json)
            return ["version": 1, "ok": true, "filename": url.lastPathComponent]
        } catch DebugReportStore.StoreError.tooLarge {
            return ["version": 1, "ok": false, "error": "report_too_large"]
        } catch {
            return ["version": 1, "ok": false, "error": "report_save_failed"]
        }
    }

    @available(iOS 26.0, *)
    private func modelProbeResponse(to message: Any?) async -> [String: Any] {
        guard BridgeContract.isValidModelProbe(message) else {
            return ["version": BridgeContract.version, "ok": false, "error": "unsupported_request"]
        }

        switch SystemLanguageModel.default.availability {
        case .available:
            do {
                let session = LanguageModelSession(instructions: "You are a local model availability diagnostic. Follow the user's request exactly.")
                let result = try await session.respond(
                    to: "Reply with exactly this text: FORM_FILL_LOCAL_MODEL_OK",
                    options: GenerationOptions(maximumResponseTokens: 16)
                )
                return [
                    "version": BridgeContract.version,
                    "ok": true,
                    "available": true,
                    "process": "safari_web_extension",
                    "result": String(result.content.prefix(160))
                ]
            } catch {
                return [
                    "version": BridgeContract.version,
                    "ok": false,
                    "available": true,
                    "process": "safari_web_extension",
                    "error": "generation_failed"
                ]
            }
        case .unavailable(let reason):
            return [
                "version": BridgeContract.version,
                "ok": true,
                "available": false,
                "reason": availabilityReason(reason)
            ]
        @unknown default:
            return [
                "version": BridgeContract.version,
                "ok": true,
                "available": false,
                "reason": "unknown"
            ]
        }
    }

    @available(iOS 26.0, *)
    private func availabilityReason(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .appleIntelligenceNotEnabled:
            return "apple_intelligence_not_enabled"
        case .deviceNotEligible:
            return "device_not_eligible"
        case .modelNotReady:
            return "model_not_ready"
        @unknown default:
            return "unknown"
        }
    }
}
