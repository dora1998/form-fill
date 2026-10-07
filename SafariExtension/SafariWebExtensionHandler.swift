import FoundationModels
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let response = NSExtensionItem()
        let message = item?.userInfo?[SFExtensionMessageKey]

        if let request = message as? [String: Any], request["version"] as? Int == 1,
           request["type"] as? String == "saveDeveloperReport", let json = request["report"] as? String {
            Task {
                var result: [String: Any]
                do {
                    guard json.utf8.count <= DebugReportStore.maximumBytes else { throw DebugReportStore.StoreError.tooLarge }
                    // Authentication failure must never fall back to saving unmasked data.
                    let profile = try await ProfileRepository.openForEditing()
                    let masked = try DeveloperReportRedactor.redact(json, profile: profile)
                    _ = try DebugReportStore.shared().save(masked)
                    result = ["version": 1, "ok": true]
                } catch DebugReportStore.StoreError.tooLarge {
                    result = ["version": 1, "ok": false, "error": "report_too_large"]
                } catch ProfileError.authentication {
                    result = ["version": 1, "ok": false, "error": "authentication_failed"]
                } catch {
                    result = ["version": 1, "ok": false, "error": "report_save_failed"]
                }
                response.userInfo = [SFExtensionMessageKey: result]
                context.completeRequest(returningItems: [response], completionHandler: nil)
            }
        } else if let request = message as? [String: Any],
           ["prepareFill", "commitFill", "cancelFill"].contains(BridgeContract.requestType(from: message) ?? "") {
            Task {
                response.userInfo = [SFExtensionMessageKey: await ProfileFillService.shared.handle(request)]
                context.completeRequest(returningItems: [response], completionHandler: nil)
            }
        } else if BridgeContract.requestType(from: message) == "analyzeForm" {
            Task {
                let result: [String: Any]
                if let request = message as? [String: Any], ProfileFillService.scope(request) != nil {
                    let classification = await FormClassifier.analyze(message)
                    result = classification["ok"] as? Bool == true
                        ? await ProfileFillService.shared.register(request, classification: classification) : classification
                } else {
                    result = ["version": 1, "ok": false, "error": "invalid_request"]
                }
                response.userInfo = [SFExtensionMessageKey: result]
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
