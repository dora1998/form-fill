import FormFillCore
import Foundation

public struct AnalyzeCommand {
    public let requestID: String
    public let fields: [FormField]
    public var developerDiagnostics: Bool = false
    public init(requestID: String, fields: [FormField], developerDiagnostics: Bool = false) {
        self.requestID = requestID
        self.fields = fields
        self.developerDiagnostics = developerDiagnostics
    }
}

public struct FieldClassification {
    public let id: String
    public let kind: FieldKind
    public let source: String
    public let label: String
    public init(id: String, kind: FieldKind, source: String, label: String) {
        self.id = id
        self.kind = kind
        self.source = source
        self.label = label
    }
}

public struct ClassificationResult {
    public let requestID: String
    public let fields: [FieldClassification]
    public let modelFailed: Bool
    public let requestedFields: Int
    public let attemptedBatches: Int
    public let reviewedBatches: Int
    public let failures: [[String: Any]]
    public var developerDiagnostics: [String: Any]? = nil
    public init(requestID: String, fields: [FieldClassification], modelFailed: Bool, requestedFields: Int, attemptedBatches: Int, reviewedBatches: Int, failures: [[String: Any]], developerDiagnostics: [String: Any]? = nil) {
        self.requestID = requestID
        self.fields = fields
        self.modelFailed = modelFailed
        self.requestedFields = requestedFields
        self.attemptedBatches = attemptedBatches
        self.reviewedBatches = reviewedBatches
        self.failures = failures
        self.developerDiagnostics = developerDiagnostics
    }
}

public enum ClassificationOutcome {
    case classified(ClassificationResult)
    case unavailable(reason: String, diagnostics: [String: Any]?)
}

public struct ClassifiedField {
    public var kind: String
    public var components: [String]
    public init(kind: String, components: [String]) {
        self.kind = kind
        self.components = components
    }
}

public struct ClassificationModelResponse {
    public let fields: [ClassifiedField]
    public let diagnosticJSON: String
    public init(fields: [ClassifiedField], diagnosticJSON: String) {
        self.fields = fields
        self.diagnosticJSON = diagnosticJSON
    }
}

public struct ClassificationModelRequest {
    public let fields: [FormField]
    public let contextFields: [FormField]
    public let groupByID: [String: String]
    public let kinds: [String: FieldKind]
    public let sources: [String: String]
    public let review: Bool
    public init(fields: [FormField], contextFields: [FormField], groupByID: [String: String], kinds: [String: FieldKind], sources: [String: String], review: Bool) {
        self.fields = fields
        self.contextFields = contextFields
        self.groupByID = groupByID
        self.kinds = kinds
        self.sources = sources
        self.review = review
    }
}

public struct ClassificationModelClient {
    /// nil means available; otherwise a stable availability reason code.
    public let unavailableReason: () -> String?
    public let generate: (ClassificationPrompt) async throws -> ClassificationModelResponse
    public init(unavailableReason: @escaping () -> String?, generate: @escaping (ClassificationPrompt) async throws -> ClassificationModelResponse) {
        self.unavailableReason = unavailableReason
        self.generate = generate
    }
}

public struct ClassificationModelFailure: Error {
    public let code: String
    public let diagnosticDescription: String
    /// Present when generation succeeded but decoding its structured response failed.
    /// The service exposes this only in explicitly requested developer diagnostics.
    public let rawResponse: String?
    public init(code: String, diagnosticDescription: String, rawResponse: String? = nil) {
        self.code = code
        self.diagnosticDescription = diagnosticDescription
        self.rawResponse = rawResponse
    }
}
