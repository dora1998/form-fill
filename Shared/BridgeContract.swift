import Foundation

enum BridgeContract {
    static let version = 1

    // Only diagnostics are implemented. Never echo arbitrary webpage data.
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
            "capabilities": ["nativeBridge": true, "profileStorage": false, "localModel": false, "autofill": false]
        ]
    }
}
