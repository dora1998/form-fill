import FormFillCore
import Foundation

/// Ephemeral, one-use authorization. Process eviction invalidates every session.
public actor ProfileFillService {
    public typealias AuthorizationFactory = (String) -> any FillAuthorization
    private let authorize: AuthorizationFactory
    private let now: () -> TimeInterval
    private enum Phase {
        case analyzed
        case authenticating(any FillAuthorization)
        case prepared(profileID: String, revision: String)
    }
    private struct Session {
        let requestID: String
        let scope: FillScope
        let fields: [FormField]
        let kinds: [String: FieldKind]
        let sources: [String: String]
        let modelFailed: Bool
        var expires: TimeInterval
        var phase: Phase = .analyzed
    }
    private var sessions = [String: Session]()

    public init(authorize: @escaping AuthorizationFactory,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.authorize = authorize
        self.now = now
    }

    public func register(_ request: AnalyzeCommand, scope: FillScope, classification: ClassificationResult) -> Result<String, FillSessionError> {
        // Revalidate correspondence at the authorization boundary, even for typed results.
        guard classification.requestID == request.requestID,
              classification.fields.count == request.fields.count,
              Set(classification.fields.map(\.id)) == Set(request.fields.map(\.id)),
              Set(request.fields.map(\.id)).count == request.fields.count,
              classification.fields.allSatisfy({ field in
                  if case .address(let parts) = field.kind { return !parts.isEmpty && Set(parts).count == parts.count }
                  return true
              })
        else { return .failure(.invalidRequest) }
        purge()
        guard sessions.count < 8 else { return .failure(.tooManyRequests) }
        let id = UUID().uuidString
        sessions[id] = Session(requestID: request.requestID, scope: scope, fields: request.fields,
            kinds: Dictionary(uniqueKeysWithValues: classification.fields.map { ($0.id, $0.kind) }),
            sources: Dictionary(uniqueKeysWithValues: classification.fields.map { ($0.id, $0.source) }),
            modelFailed: classification.modelFailed, expires: now() + 120)
        return .success(id)
    }

    public func handle(_ request: FillCommand) async -> FillResponse {
        purge()
        let id = request.sessionID
        guard let session = sessions[id], session.scope == request.scope,
              request.requestID == session.requestID else { return .failure("stale_plan") }
        if request.operation == .cancel {
            remove(id)
            return .cancelled
        }
        let preparing = request.operation == .prepare
        let quick = request.operation == .quick
        let preparedProfile: (id: String, revision: String)?
        switch (request.operation, session.phase) {
        case (.prepare, .analyzed), (.quick, .analyzed): preparedProfile = nil
        case (.commit, .prepared(let profileID, let revision)): preparedProfile = (profileID, revision)
        default: return .failure("stale_plan")
        }
        let reason = quick
            ? "\(session.scope.origin)に登録した姓名・住所を入力します。既存の入力値は上書きされます。"
            : "保存した姓名・住所を使用します"
        // Each operation gets a new authentication session, including commit.
        let authorization = authorize(reason)
        sessions[id]?.phase = .authenticating(authorization)
        defer { authorization.cancel() }
        do {
            let profile = try await authorization.loadProfile()
            guard let current = sessions[id], current.expires > now(),
                  case .authenticating(let active) = current.phase, active === authorization else {
                remove(id)
                return .failure("stale_plan")
            }
            if let preparedProfile, preparedProfile.id != profile.id || preparedProfile.revision != profile.revision {
                remove(id)
                return .failure("profile_changed")
            }
            let plan = FillPlanner.plan(fields: session.fields, kinds: session.kinds,
                sources: session.sources, modelFailed: session.modelFailed, profile: profile)
            if preparing {
                sessions[id]?.phase = .prepared(profileID: profile.id, revision: profile.revision)
                sessions[id]?.expires = now() + 60
            } else {
                remove(id) // Consume before returning any values to the browser.
            }
            return .plan(plan, requestID: session.requestID, sessionID: id, expiresInSeconds: preparing ? 60 : nil)
        } catch {
            remove(id)
            return .failure((error as? ProfileError)?.code ?? "storage_unavailable")
        }
    }

    private func remove(_ id: String) {
        if case .authenticating(let authorization) = sessions.removeValue(forKey: id)?.phase {
            authorization.cancel()
        }
    }
    private func purge() {
        for id in sessions.keys.filter({ sessions[$0]!.expires <= now() }) { remove(id) }
    }
}

public enum FillSessionError: String, Error {
    case invalidRequest = "invalid_request", tooManyRequests = "too_many_requests"
}
