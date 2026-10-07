import FormFillCore
import Foundation

public struct FillScope: Equatable {
    public let tabID: Int
    public let origin: String
    public init(tabID: Int, origin: String) {
        self.tabID = tabID
        self.origin = origin
    }
}

public enum FillOperation: String {
    case prepare = "prepareFill", commit = "commitFill", quick = "quickFill", cancel = "cancelFill"
}

public struct FillCommand {
    public let operation: FillOperation
    public let sessionID: String
    public let requestID: String
    public let scope: FillScope
    public init(operation: FillOperation, sessionID: String, requestID: String, scope: FillScope) {
        self.operation = operation
        self.sessionID = sessionID
        self.requestID = requestID
        self.scope = scope
    }
}

public enum FillResponse {
    case cancelled
    case plan(FillPlan, requestID: String, sessionID: String, expiresInSeconds: Int?)
    case failure(String)
}

/// A fresh operation per authentication. Cancellation must invalidate OS authentication.
public protocol FillAuthorization: AnyObject {
    func loadProfile() async throws -> Profile
    func cancel()
}
