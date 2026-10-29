import FormFillCore
import FormFillApplication
import Foundation
import CoreFoundation

public enum NativeRequest {
    case health, modelProbe
    case saveDeveloperReport(String)
    case analyze(AnalyzeCommand, FillScope)
    case fill(FillCommand)
}

public enum BridgeContract {
    public static let version = 1

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              let result = value as? Int, number.doubleValue == Double(result) else { return nil }
        return result
    }

    public static func requestType(from message: Any?) -> String? {
        (message as? [String: Any])?["type"] as? String
    }

    // Fixed health response. Never echo arbitrary webpage data.
    public static func response(to message: Any?) -> [String: Any] {
        guard let request = message as? [String: Any],
              let requestVersion = integer(request["version"]),
              requestVersion == version,
              request["type"] as? String == "health" else {
            return ["version": version, "ok": false, "error": "unsupported_request"]
        }
        return [
            "version": version,
            "ok": true,
            "capabilities": ["nativeBridge": true, "profileStorage": true, "localModelProbe": true, "localModel": true, "autofill": true]
        ]
    }
    public static func decodeAnalysis(_ message: Any?) -> AnalyzeCommand? {
        guard let request = message as? [String: Any], integer(request["version"]) == version,
              request["type"] as? String == "analyzeForm",
              let id = request["requestID"] as? String, UUID(uuidString: id) != nil,
              let raw = request["fields"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), data.count <= 100_000,
              let fields = try? JSONDecoder().decode([FormField].self, from: data), fields.count <= 40,
              Set(fields.map(\.id)).count == fields.count,
              fields.allSatisfy({ field in
                  field.id.range(of: "^f[0-9]{1,2}$", options: .regularExpression) != nil
                  && ["input", "select", "textarea"].contains(field.tag)
                  && (["text", "number", "search", "select-one", "textarea", ""].contains(field.type) || field.type == "tel" && field.isPostalControl)
                  && (field.groupID == nil || field.groupID!.range(of: "^g[0-9]{1,2}$", options: .regularExpression) != nil)
                  && field.maxLength >= 0 && field.maxLength <= 100_000
                  && [field.label, field.ariaLabel, field.name, field.htmlID, field.placeholder, field.autocomplete, field.context, field.pattern].allSatisfy { $0.count <= 120 }
                  && field.options.count <= 60 && field.options.allSatisfy { $0.value.count <= 120 && $0.text.count <= 120 }
              }) else { return nil }
        return AnalyzeCommand(requestID: id, fields: fields, developerDiagnostics: request["developerDiagnostics"] as? Bool == true)
    }


    public static func decodeScope(_ request: [String: Any]) -> FillScope? {
        guard let tab = integer(request["tabID"]), tab >= 0,
              let origin = request["origin"] as? String, origin.count <= 2048,
              let url = URLComponents(string: origin), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty else { return nil }
        return FillScope(tabID: tab, origin: origin)
    }

    public static func decode(_ message: Any?) -> NativeRequest? {
        guard let raw = message as? [String: Any], integer(raw["version"]) == version,
              let type = raw["type"] as? String else { return nil }
        switch type {
        case "health": return .health
        case "modelProbe": return .modelProbe
        case "saveDeveloperReport":
            guard let json = raw["report"] as? String else { return nil }
            return .saveDeveloperReport(json)
        case "analyzeForm":
            guard let command = decodeAnalysis(raw), let scope = decodeScope(raw) else { return nil }
            return .analyze(command, scope)
        default:
            guard let operation = FillOperation(rawValue: type), let scope = decodeScope(raw),
                  let id = raw["sessionID"] as? String,
                  let requestID = raw["requestID"] as? String else { return nil }
            return .fill(FillCommand(operation: operation, sessionID: id, requestID: requestID, scope: scope))
        }
    }
}
