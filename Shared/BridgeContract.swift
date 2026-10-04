import Foundation

enum BridgeContract {
    static let version = 1

    static func requestType(from message: Any?) -> String? {
        (message as? [String: Any])?["type"] as? String
    }

    static func isValidModelProbe(_ message: Any?) -> Bool {
        guard let request = message as? [String: Any] else { return false }
        return request["version"] as? Int == version && request["type"] as? String == "modelProbe"
    }

    // Fixed health response. Never echo arbitrary webpage data.
    static func response(to message: Any?) -> [String: Any] {
        guard let request = message as? [String: Any],
              let requestVersion = request["version"] as? Int,
              requestVersion == version,
              request["type"] as? String == "health" else {
            return ["version": version, "ok": false, "error": "unsupported_request"]
        }
        return [
            "version": version,
            "ok": true,
            "capabilities": ["nativeBridge": true, "profileStorage": false, "localModelProbe": true, "localModel": true, "autofill": true]
        ]
    }
}
