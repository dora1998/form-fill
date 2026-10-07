import Foundation

/// The diagnostics envelope and limits are independent of its storage backend.
public enum DeveloperReportError: Error { case invalidReport, tooLarge }

public struct DeveloperReport {
    public static let maximumBytes = 20 * 1024 * 1024
    public static let product = "Form Fill developer diagnostics"
    let object: [String: Any]
    public var currentPageURL: String? { object["currentPageURL"] as? String }

    public init(json: String) throws {
        guard json.utf8.count <= Self.maximumBytes else { throw DeveloperReportError.tooLarge }
        guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
              object["schemaVersion"] as? Int == 1,
              object["product"] as? String == Self.product else {
            throw DeveloperReportError.invalidReport
        }
        self.object = object
    }
}

/// Created only by the masking policy, never directly from an incoming bridge string.
public struct RedactedDeveloperReport {
    public let json: String
    // Internal to the diagnostics core. Storage consumers cannot construct this value.
    init(maskedJSON: String) throws {
        guard maskedJSON.utf8.count <= DeveloperReport.maximumBytes else { throw DeveloperReportError.tooLarge }
        json = maskedJSON
    }
}
