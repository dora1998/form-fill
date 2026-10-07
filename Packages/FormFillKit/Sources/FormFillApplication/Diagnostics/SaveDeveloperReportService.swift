import FormFillCore
import Foundation

public struct SaveDeveloperReportService {
    public var loadProfile: () async throws -> Profile?
    public var persist: (RedactedDeveloperReport) async throws -> Void

    public init(loadProfile: @escaping () async throws -> Profile?,
                persist: @escaping (RedactedDeveloperReport) async throws -> Void) {
        self.loadProfile = loadProfile
        self.persist = persist
    }

    public func run(_ json: String) async throws {
        // Reject malformed/oversized input before presenting authentication.
        let report = try DeveloperReport(json: json)
        let profile = try await loadProfile()
        let masked = try DeveloperReportRedactor.redact(report, profile: profile)
        try await persist(masked)
    }
}
