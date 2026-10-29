import FormFillCore
import FormFillApplication
import Foundation
import LocalAuthentication

/// Apple adapter: one context per operation, invalidated on cancellation and completion.
public final class LocalProfileAuthorization: FillAuthorization {
    private let context: LAContext
    public init(reason: String) {
        context = ProfileAuthenticationClient.live.makeContext()
        context.localizedReason = reason
    }
    public func loadProfile() async throws -> Profile { try await KeychainProfileRepository.live.load(context: context) }
    public func cancel() { context.invalidate() }
}
