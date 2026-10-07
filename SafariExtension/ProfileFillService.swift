import Foundation
import LocalAuthentication

/// Ephemeral, one-use authorization. Process eviction invalidates every session.
actor ProfileFillService {
    static let shared = ProfileFillService()
    typealias Loader = (LAContext) async throws -> Profile
    private let load: Loader
    private let now: () -> TimeInterval
    private struct Session {
        let requestID: String
        let tabID: Int
        let origin: String
        let fields: [FormField]
        let kinds: [String: FieldKind]
        let sources: [String: String]
        let modelFailed: Bool
        var expires: TimeInterval
        var phase = "analyzed"
        var profileID: String?
        var revision: String?
        var context: LAContext?
    }
    private var sessions = [String: Session]()

    init(load: @escaping Loader = { try await ProfileRepository.load(context: $0) },
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.load = load
        self.now = now
    }

    static func scope(_ request: [String: Any]) -> (Int, String)? {
        guard let tab = request["tabID"] as? Int, tab >= 0,
              let origin = request["origin"] as? String, origin.count <= 2048,
              let url = URLComponents(string: origin), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty else { return nil }
        return (tab, origin)
    }

    func register(_ request: [String: Any], classification: [String: Any]) -> [String: Any] {
        guard let (requestID, fields) = FillPlanner.decode(request), let (tabID, origin) = Self.scope(request),
              classification["ok"] as? Bool == true,
              let raw = classification["classifications"] as? [[String: String]], raw.count == fields.count,
              Set(raw.compactMap { $0["id"] }) == Set(fields.map(\.id)),
              raw.allSatisfy({ FieldKind(rawValue: $0["kind"] ?? "") != nil }) else { return failure("invalid_request") }
        purge()
        // Bounded memory, including website metadata; do not persist sessions.
        if sessions.count >= 8 { return failure("too_many_requests") }
        let id = UUID().uuidString
        sessions[id] = Session(requestID: requestID, tabID: tabID, origin: origin, fields: fields,
            kinds: Dictionary(uniqueKeysWithValues: raw.map { ($0["id"]!, FieldKind(rawValue: $0["kind"]!)!) }),
            sources: Dictionary(uniqueKeysWithValues: raw.map { ($0["id"]!, $0["source"] ?? "model") }),
            modelFailed: classification["modelFailed"] as? Bool ?? false, expires: now() + 120)
        var result = classification
        result["sessionID"] = id
        return result
    }

    func handle(_ request: [String: Any]) async -> [String: Any] {
        purge()
        guard request["version"] as? Int == 1,
              let id = request["sessionID"] as? String,
              let session = sessions[id], let (tabID, origin) = Self.scope(request),
              session.tabID == tabID, session.origin == origin,
              request["requestID"] as? String == session.requestID else { return failure("stale_plan") }
        let type = request["type"] as? String
        if type == "cancelFill" {
            remove(id)
            return ["version": 1, "ok": true]
        }
        let preparing = type == "prepareFill"
        let quick = type == "quickFill"
        guard preparing || quick || type == "commitFill",
              session.phase == (preparing || quick ? "analyzed" : "prepared") else { return failure("stale_plan") }
        // A new context at commit deliberately rechecks OS authentication rather
        // than trusting a shared unlocked flag or a previous device-unlock state.
        let context = ProfileRepository.context()
        if quick {
            context.localizedReason = "\(session.origin)に登録した姓名・住所を入力します。既存の入力値は上書きされます。"
        }
        sessions[id]?.phase = preparing ? "preparing" : "committing"
        sessions[id]?.context = context
        defer { context.invalidate() }
        do {
            let profile = try await load(context)
            guard let current = sessions[id], current.context === context, current.expires > now() else {
                remove(id)
                return failure("stale_plan")
            }
            if !preparing && !quick && (current.profileID != profile.id || current.revision != profile.revision) {
                remove(id)
                return failure("profile_changed")
            }
            var plan = FillPlanner.plan(fields: session.fields, kinds: session.kinds,
                sources: session.sources, modelFailed: session.modelFailed, profile: profile)
            plan["requestID"] = session.requestID
            plan["sessionID"] = id
            if preparing {
                sessions[id]?.phase = "prepared"
                sessions[id]?.context = nil
                sessions[id]?.profileID = profile.id
                sessions[id]?.revision = profile.revision
                sessions[id]?.expires = now() + 60
                plan["expiresInSeconds"] = 60
            } else {
                remove(id) // Consume before returning any values to the browser.
            }
            return plan
        } catch {
            remove(id)
            return failure((error as? ProfileError)?.code ?? "storage_unavailable")
        }
    }

    private func failure(_ code: String) -> [String: Any] { ["version": 1, "ok": false, "error": code] }
    private func remove(_ id: String) {
        sessions.removeValue(forKey: id)?.context?.invalidate()
    }
    private func purge() {
        for id in sessions.keys.filter({ sessions[$0]!.expires <= now() }) { remove(id) }
    }
}
