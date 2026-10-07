import Foundation
import LocalAuthentication

actor TestLoader {
    var profile: Profile?
    var requests = 0
    var reasons = [String]()
    var fail = false
    var suspend = false
    var continuation: CheckedContinuation<Profile, Error>?
    init(_ profile: Profile) { self.profile = profile }
    func read(_ context: LAContext) async throws -> Profile {
        requests += 1
        reasons.append(context.localizedReason)
        if suspend { return try await withCheckedThrowingContinuation { continuation = $0 } }
        if fail { throw ProfileError.authentication }
        guard let profile else { throw ProfileError.missing }
        return profile
    }
    func edit() { profile?.revision = UUID().uuidString }
    func delete() { profile = nil }
    func deny() { fail = true }
    func pause() { suspend = true }
    func resume() { continuation?.resume(returning: profile!); continuation = nil }
    func waiting() -> Bool { continuation != nil }
}
final class TestClock { var value: TimeInterval = 0 }

func check(_ condition: Bool, line: UInt = #line) { precondition(condition, "check failed at line \(line)") }

@main struct ProfileSecurityTests {
    static func main() async throws {
        var profile = Profile()
        profile.family = "試験"; profile.given = "花子"; profile.familyKana = "シケン"; profile.givenKana = "ハナコ"
        profile.postal = "1600022"; profile.municipality = "新宿区"; profile.locality = "新宿"; profile.street = "0-0"
        _ = try profile.validated()
        let vault = ProfileVault(profiles: [profile], activeProfileID: profile.id)
        let data = try JSONEncoder().encode(vault)
        check(try JSONDecoder().decode(ProfileVault.self, from: data).activeProfile() == profile)
        var bad = profile; bad.postal = "160-0022"
        do { _ = try bad.validated(); preconditionFailure("invalid postal accepted") } catch ProfileError.invalidProfile {}
        var broken = vault; broken.schemaVersion = 2
        do { _ = try broken.activeProfile(); preconditionFailure("unknown schema accepted") } catch ProfileError.invalidStore {}
        broken = vault; broken.activeProfileID = UUID().uuidString
        do { _ = try broken.activeProfile(); preconditionFailure("missing selection accepted") } catch ProfileError.invalidStore {}

        let field: [String: Any] = ["id": "f0", "tag": "input", "type": "text", "label": "姓", "ariaLabel": "", "name": "", "htmlID": "", "placeholder": "", "autocomplete": "family-name", "context": "", "maxLength": 0, "pattern": "", "occupied": false, "options": [[String: Any]]()]
        let base: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString,
                                  "tabID": 5, "origin": "https://example.test", "fields": [field]]
        let classification: [String: Any] = ["version": 1, "ok": true, "requestID": base["requestID"]!,
            "classifications": [["id": "f0", "kind": "family", "source": "rule", "label": "姓"]]]
        func request(_ type: String, _ id: String) -> [String: Any] {
            var r = base; r["type"] = type; r["sessionID"] = id; return r
        }
        func session(_ service: ProfileFillService) async -> String {
            let response = await service.register(base, classification: classification)
            check(response["items"] == nil)
            return response["sessionID"] as! String
        }
        let loader = TestLoader(profile)
        let clock = TestClock()
        let service = ProfileFillService(load: { try await loader.read($0) }, now: { clock.value })
        let first = await session(service)
        check(await loader.requests == 0)
        check((await service.handle(request("commitFill", first)))["error"] as? String == "stale_plan")
        var wrongOrigin = request("prepareFill", first); wrongOrigin["origin"] = "https://other.test"
        check((await service.handle(wrongOrigin))["error"] as? String == "stale_plan")
        let prepared = await service.handle(request("prepareFill", first))
        check((prepared["items"] as? [[String: Any]])?.first?["value"] as? String == profile.family)
        let committed = await service.handle(request("commitFill", first))
        check(committed["ok"] as? Bool == true)
        check(await loader.requests == 2)
        check((await service.handle(request("commitFill", first)))["error"] as? String == "stale_plan")
        let edited = await session(service)
        _ = await service.handle(request("prepareFill", edited)); await loader.edit()
        check((await service.handle(request("commitFill", edited)))["error"] as? String == "profile_changed")
        let expired = await session(service)
        _ = await service.handle(request("prepareFill", expired)); clock.value += 61
        check((await service.handle(request("commitFill", expired)))["error"] as? String == "stale_plan")
        let deleted = await session(service)
        _ = await service.handle(request("prepareFill", deleted)); await loader.delete()
        check((await service.handle(request("commitFill", deleted)))["error"] as? String == "profile_missing")
        let deniedLoader = TestLoader(profile); await deniedLoader.deny()
        let deniedService = ProfileFillService(load: { try await deniedLoader.read($0) })
        let deniedID = await session(deniedService)
        let denied = await deniedService.handle(request("prepareFill", deniedID))
        check(denied["error"] as? String == "authentication_failed" && denied["items"] == nil)
        let pendingLoader = TestLoader(profile); await pendingLoader.pause()
        let pendingService = ProfileFillService(load: { try await pendingLoader.read($0) })
        let pendingID = await session(pendingService)
        let task = Task { await pendingService.handle(request("prepareFill", pendingID)) }
        while !(await pendingLoader.waiting()) { await Task.yield() }
        check((await pendingService.handle(request("prepareFill", pendingID)))["error"] as? String == "stale_plan")
        _ = await pendingService.handle(request("cancelFill", pendingID))
        await pendingLoader.resume()
        let cancelled = await task.value
        check(cancelled["error"] as? String == "stale_plan" && cancelled["items"] == nil)
        let quickLoader = TestLoader(profile)
        let quickClock = TestClock()
        let quickService = ProfileFillService(load: { try await quickLoader.read($0) }, now: { quickClock.value })
        let quickID = await session(quickService)
        var quickWrong = request("quickFill", quickID); quickWrong["tabID"] = 6
        check((await quickService.handle(quickWrong))["error"] as? String == "stale_plan")
        let quickResult = await quickService.handle(request("quickFill", quickID))
        check((quickResult["items"] as? [[String: Any]])?.first?["value"] as? String == profile.family)
        check(await quickLoader.requests == 1)
        check((await quickLoader.reasons).first?.contains("https://example.test") == true)
        check((await quickService.handle(request("quickFill", quickID)))["error"] as? String == "stale_plan")
        let quickExpired = await session(quickService); quickClock.value += 121
        check((await quickService.handle(request("quickFill", quickExpired)))["error"] as? String == "stale_plan")
        let quickDenied = await session(deniedService)
        check((await deniedService.handle(request("quickFill", quickDenied)))["error"] as? String == "authentication_failed")
        await pendingLoader.pause()
        let quickPending = await session(pendingService)
        let quickTask = Task { await pendingService.handle(request("quickFill", quickPending)) }
        while !(await pendingLoader.waiting()) { await Task.yield() }
        check((await pendingService.handle(request("quickFill", quickPending)))["error"] as? String == "stale_plan")
        _ = await pendingService.handle(request("cancelFill", quickPending))
        await pendingLoader.resume()
        check((await quickTask.value)["error"] as? String == "stale_plan")
        print("Profile security: schema, explicit profile composition, auth failure, scope, replay, expiry, edit/delete, concurrent requests and cancellation passed")
    }
}
