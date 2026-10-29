import FormFillCore
import FormFillApplication
import Foundation
import FoundationModels

@Generable
struct GeneratedClassifiedField {
    @Guide(description: "One permitted kind. Use unknown whenever ambiguous.", .anyOf(FieldKind.permittedKinds))
    var kind: String
    @Guide(description: "Address components, once each; empty for non-address kinds.", .count(0...5))
    var components: [String]
}

@Generable
struct GeneratedFormClassification {
    @Guide(description: "Classify the requested fields in exact input order.", .count(0...4))
    var fields: [GeneratedClassifiedField]
}

public enum FoundationModelsClient {
    // Exact count and positional mapping avoid generating IDs redundantly.
    // The public response still contains the original requested opaque IDs.
    static func outputSchema(for ids: [String]) throws -> GenerationSchema {
        let item = DynamicGenerationSchema(name: "ClassifiedField", properties: [
            .init(name: "kind", description: "Use unknown when ambiguous.",
                  schema: DynamicGenerationSchema(type: String.self, guides: [.anyOf(FieldKind.permittedKinds)])),
            .init(name: "components", description: "For address, list accepted components once each; otherwise empty.",
                  schema: DynamicGenerationSchema(arrayOf: DynamicGenerationSchema(type: String.self,
                      guides: [.anyOf(AddressComponent.allCases.map(\.rawValue))]), minimumElements: 0, maximumElements: 5))
        ])
        let root = DynamicGenerationSchema(name: "FormClassification", properties: [
            .init(name: "fields", schema: DynamicGenerationSchema(arrayOf: item,
                  minimumElements: ids.count, maximumElements: ids.count))
        ])
        return try GenerationSchema(root: root, dependencies: [])
    }
    static func unavailableReason() -> String? {
        switch SystemLanguageModel.default.availability {
        case .available: return nil
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled: return "apple_intelligence_not_enabled"
            case .deviceNotEligible: return "device_not_eligible"
            case .modelNotReady: return "model_not_ready"
            @unknown default: return "unknown"
            }
        @unknown default: return "unknown"
        }
    }

    public static var classification: ClassificationModelClient {
        ClassificationModelClient(unavailableReason: unavailableReason, generate: { request in
            var rawResponse: String?
            do {
                let session = LanguageModelSession(instructions: request.instructions)
                let result = try await session.respond(to: request.prompt,
                    schema: try outputSchema(for: request.ids),
                    options: GenerationOptions(sampling: .greedy, maximumResponseTokens: 600))
                rawResponse = result.content.jsonString
                let entries = try GeneratedFormClassification(result.content).fields
                return ClassificationModelResponse(fields: entries.map { ClassifiedField(kind: $0.kind, components: $0.components) },
                    diagnosticJSON: result.content.jsonString)
            } catch {
                throw ClassificationModelFailure(code: failureCode(error), diagnosticDescription: String(reflecting: error),
                    rawResponse: rawResponse)
            }
        })
    }

    public static func probe() async -> [String: Any] {
        if let reason = unavailableReason() {
            return ["version": 1, "ok": true, "available": false, "reason": reason]
        }
        do {
            let session = LanguageModelSession(instructions: "You are a local model availability diagnostic. Follow the user's request exactly.")
            let result = try await session.respond(to: "Reply with exactly this text: FORM_FILL_LOCAL_MODEL_OK",
                options: GenerationOptions(maximumResponseTokens: 16))
            return ["version": 1, "ok": true, "available": true, "process": "safari_web_extension", "result": String(result.content.prefix(160))]
        } catch {
            return ["version": 1, "ok": false, "available": true, "process": "safari_web_extension", "error": "generation_failed"]
        }
    }

    // Error descriptions/contexts may contain website strings. Export enum codes only.
    private static func failureCode(_ error: Error) -> String {
        #if compiler(>=6.4)
        if #available(iOS 27.0, macOS 27.0, *) {
            if let error = error as? LanguageModelError {
                switch error {
                case .contextSizeExceeded: return "context_limit"
                case .rateLimited: return "rate_limited"
                case .guardrailViolation: return "guardrail_violation"
                case .refusal: return "refusal"
                case .unsupportedCapability, .unsupportedTranscriptContent: return "unsupported_capability"
                case .unsupportedGenerationGuide: return "unsupported_guide"
                case .unsupportedLanguageOrLocale: return "unsupported_locale"
                case .timeout: return "generation_timeout"
                @unknown default: return "unknown"
                }
            }
            if error is SystemLanguageModel.Error { return "assets_unavailable" }
            if error is GeneratedContent.ParsingError { return "decoding_failure" }
            if let error = error as? LanguageModelSession.Error {
                switch error {
                case .concurrentRequests: return "concurrent_requests"
                case .transcriptMutationWhileResponding: return "session_mutated"
                @unknown default: return "unknown"
                }
            }
        }
        #endif
        if let error = error as? LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize: return "context_limit"
            case .assetsUnavailable: return "assets_unavailable"
            case .guardrailViolation: return "guardrail_violation"
            case .unsupportedGuide: return "unsupported_guide"
            case .unsupportedLanguageOrLocale: return "unsupported_locale"
            case .decodingFailure: return "decoding_failure"
            case .rateLimited: return "rate_limited"
            case .concurrentRequests: return "concurrent_requests"
            case .refusal: return "refusal"
            @unknown default: return "unknown"
            }
        }
        return "unknown"
    }
}
