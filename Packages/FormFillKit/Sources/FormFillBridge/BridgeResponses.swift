import FormFillCore
import FormFillApplication
import Foundation

/// Wire serialization stays at the native transport boundary.
public enum BridgeResponses {
    public static func failure(_ code: String) -> [String: Any] { ["version": BridgeContract.version, "ok": false, "error": code] }

    public static func classification(_ result: ClassificationResult, sessionID: String? = nil) -> [String: Any] {
        var wire: [String: Any] = ["version": BridgeContract.version, "ok": true,
            "requestID": result.requestID, "classifierVersion": 12, "modelFailed": result.modelFailed,
            "classifications": result.fields.map { ["id": $0.id, "label": $0.label, "kind": $0.kind.rawValue,
                "components": $0.kind.components.map(\.rawValue), "source": $0.source] as [String: Any] },
            "modelDiagnostics": ["available": true, "requestedFields": result.requestedFields,
                "attemptedBatches": result.attemptedBatches, "reviewedBatches": result.reviewedBatches,
                "failures": result.failures]]
        wire["sessionID"] = sessionID
        wire["developerDiagnostics"] = result.developerDiagnostics
        return wire
    }

    public static func classification(_ outcome: ClassificationOutcome) -> [String: Any] {
        switch outcome {
        case .classified(let result): return classification(result)
        case .unavailable(let reason, let diagnostics):
            var wire = failure("model_unavailable")
            wire["classifierVersion"] = 12
            wire["reason"] = reason
            wire["developerDiagnostics"] = diagnostics
            return wire
        }
    }

    public static func plan(_ plan: FillPlan) -> [String: Any] {
        ["version": BridgeContract.version, "ok": true, "profileID": plan.profileID,
         "modelFailed": plan.modelFailed,
         "items": plan.items.map { ["id": $0.id, "label": $0.label, "kind": $0.kind.rawValue,
            "components": $0.kind.components.map(\.rawValue), "value": $0.value,
            "displayValue": $0.displayValue, "source": $0.source, "overwritesExisting": $0.overwritesExisting] as [String: Any] },
         "skipped": plan.skipped.map { ["id": $0.id, "label": $0.label, "kind": $0.kind.rawValue,
            "components": $0.kind.components.map(\.rawValue), "reason": $0.reason.message,
            "reasonCode": $0.reason.rawValue, "source": $0.source] as [String: Any] }]
    }

    public static func fill(_ response: FillResponse) -> [String: Any] {
        switch response {
        case .cancelled: return ["version": BridgeContract.version, "ok": true]
        case .failure(let code): return failure(code)
        case .plan(let result, let requestID, let sessionID, let expiry):
            var wire = plan(result)
            wire["requestID"] = requestID
            wire["sessionID"] = sessionID
            wire["expiresInSeconds"] = expiry
            return wire
        }
    }
}

extension SkipReason {
    public var message: String {
        switch self {
        case .emptyProfile: return "登録情報が空です"
        case .valueTooLong: return "入力値が長すぎます"
        case .unclassified: return "項目を判定できません"
        case .noMatchingOption: return "一致する選択肢がありません"
        case .patternConstraint: return "入力形式の制約に合いません"
        case .lengthConstraint: return "文字数制限に合いません"
        case .numberConstraint: return "数値欄の制約に合いません"
        case .groupOverlap: return "グループ内の入力内容が重複しています"
        case .addressOverlap: return "住所欄の構成が重複しています"
        }
    }
}
