import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

actor TestLoader {
    var profile: Profile?
    var requests = 0
    var fail = false
    var suspend = false
    var continuation: CheckedContinuation<Profile, Error>?
    init(_ profile: Profile) { self.profile = profile }
    func read() async throws -> Profile {
        requests += 1
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
final class TestAuthorization: FillAuthorization {
    let loader: TestLoader
    let reason: String
    var cancelled = false
    init(_ loader: TestLoader, reason: String) { self.loader = loader; self.reason = reason }
    func loadProfile() async throws -> Profile { try await loader.read() }
    func cancel() { cancelled = true }
}
final class TestClock { var value: TimeInterval = 0 }
final class TestAuthorizations {
    var sessions = [TestAuthorization]()
    let loader: TestLoader
    init(_ loader: TestLoader) { self.loader = loader }
    func make(_ reason: String) -> TestAuthorization {
        let result = TestAuthorization(loader, reason: reason)
        sessions.append(result)
        return result
    }
}
func check(_ condition: Bool, line: UInt = #line) { precondition(condition, "check failed at line \(line)") }
func errorCode(_ result: FillResponse) -> String? { if case .failure(let error) = result { return error }; return nil }
func planValue(_ result: FillResponse) -> String? { if case .plan(let plan, _, _, _) = result { return plan.items.first?.value }; return nil }

final class ProfileSecurityTests: XCTestCase {
    func testRegression() async throws {
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

        let field = FormField(id: "f0", tag: "input", type: "text", label: "姓", ariaLabel: "", name: "", htmlID: "", placeholder: "", autocomplete: "family-name", context: "", maxLength: 0, pattern: "", occupied: false, options: [])
        let command = AnalyzeCommand(requestID: UUID().uuidString, fields: [field])
        let scope = FillScope(tabID: 5, origin: "https://example.test")
        let classification = ClassificationResult(requestID: command.requestID,
            fields: [FieldClassification(id: "f0", kind: .family, source: "rule", label: "姓")],
            modelFailed: false, requestedFields: 0, attemptedBatches: 0, reviewedBatches: 0, failures: [])
        func request(_ operation: FillOperation, _ id: String, scope override: FillScope? = nil) -> FillCommand {
            FillCommand(operation: operation, sessionID: id, requestID: command.requestID, scope: override ?? scope)
        }
        func session(_ service: ProfileFillService) async throws -> String {
            try await service.register(command, scope: scope, classification: classification).get()
        }
        let loader = TestLoader(profile)
        let clock = TestClock()
        let auth = TestAuthorizations(loader)
        let service = ProfileFillService(authorize: auth.make, now: { clock.value })
        let first = try await session(service)
        check(await loader.requests == 0)
        check(errorCode(await service.handle(request(.commit, first))) == "stale_plan")
        check(errorCode(await service.handle(request(.prepare, first, scope: FillScope(tabID: 5, origin: "https://other.test")))) == "stale_plan")
        check(planValue(await service.handle(request(.prepare, first))) == profile.family)
        check(auth.sessions.count == 1 && auth.sessions[0].cancelled)
        check(planValue(await service.handle(request(.commit, first))) == profile.family)
        check(await loader.requests == 2)
        check(auth.sessions.count == 2 && auth.sessions[0] !== auth.sessions[1] && auth.sessions[1].cancelled)
        check(errorCode(await service.handle(request(.commit, first))) == "stale_plan")
        let edited = try await session(service)
        _ = await service.handle(request(.prepare, edited)); await loader.edit()
        check(errorCode(await service.handle(request(.commit, edited))) == "profile_changed")
        let expired = try await session(service)
        _ = await service.handle(request(.prepare, expired)); clock.value += 61
        check(errorCode(await service.handle(request(.commit, expired))) == "stale_plan")
        let deleted = try await session(service)
        _ = await service.handle(request(.prepare, deleted)); await loader.delete()
        check(errorCode(await service.handle(request(.commit, deleted))) == "profile_missing")
        let deniedLoader = TestLoader(profile); await deniedLoader.deny()
        let deniedAuth = TestAuthorizations(deniedLoader)
        let deniedService = ProfileFillService(authorize: deniedAuth.make)
        let deniedID = try await session(deniedService)
        check(errorCode(await deniedService.handle(request(.prepare, deniedID))) == "authentication_failed")
        let pendingLoader = TestLoader(profile); await pendingLoader.pause()
        let pendingAuth = TestAuthorizations(pendingLoader)
        let pendingService = ProfileFillService(authorize: pendingAuth.make)
        let pendingID = try await session(pendingService)
        let task = Task { await pendingService.handle(request(.prepare, pendingID)) }
        while !(await pendingLoader.waiting()) { await Task.yield() }
        check(errorCode(await pendingService.handle(request(.prepare, pendingID))) == "stale_plan")
        _ = await pendingService.handle(request(.cancel, pendingID))
        check(pendingAuth.sessions[0].cancelled)
        await pendingLoader.resume()
        check(errorCode(await task.value) == "stale_plan")
        let quickLoader = TestLoader(profile)
        let quickClock = TestClock()
        let quickAuth = TestAuthorizations(quickLoader)
        let quickService = ProfileFillService(authorize: quickAuth.make, now: { quickClock.value })
        let quickID = try await session(quickService)
        check(errorCode(await quickService.handle(request(.quick, quickID, scope: FillScope(tabID: 6, origin: scope.origin)))) == "stale_plan")
        check(planValue(await quickService.handle(request(.quick, quickID))) == profile.family)
        check(await quickLoader.requests == 1)
        check(quickAuth.sessions[0].reason.contains(scope.origin))
        check(errorCode(await quickService.handle(request(.quick, quickID))) == "stale_plan")
        let quickExpired = try await session(quickService); quickClock.value += 121
        check(errorCode(await quickService.handle(request(.quick, quickExpired))) == "stale_plan")
        let quickDenied = try await session(deniedService)
        check(errorCode(await deniedService.handle(request(.quick, quickDenied))) == "authentication_failed")
        let quickPending = try await session(pendingService)
        let quickTask = Task { await pendingService.handle(request(.quick, quickPending)) }
        while !(await pendingLoader.waiting()) { await Task.yield() }
        check(errorCode(await pendingService.handle(request(.quick, quickPending))) == "stale_plan")
        _ = await pendingService.handle(request(.cancel, quickPending))
        check(pendingAuth.sessions.last!.cancelled)
        await pendingLoader.resume()
        check(errorCode(await quickTask.value) == "stale_plan")
        // Typed results are still checked at the authorization boundary.
        let wrong = ClassificationResult(requestID: UUID().uuidString, fields: classification.fields,
            modelFailed: false, requestedFields: 0, attemptedBatches: 0, reviewedBatches: 0, failures: [])
        if case .success = await service.register(command, scope: scope, classification: wrong) { preconditionFailure("foreign result accepted") }
        for kind in [FieldKind.address([]), .address([.street, .street])] {
            let invalid = ClassificationResult(requestID: command.requestID,
                fields: [FieldClassification(id: "f0", kind: kind, source: "model", label: "住所")],
                modelFailed: false, requestedFields: 1, attemptedBatches: 1, reviewedBatches: 0, failures: [])
            if case .success = await service.register(command, scope: scope, classification: invalid) { preconditionFailure("invalid address accepted") }
        }
        let address = ClassificationResult(requestID: command.requestID,
            fields: [FieldClassification(id: "f0", kind: .address([.locality, .municipality]), source: "model", label: "住所")],
            modelFailed: false, requestedFields: 1, attemptedBatches: 1, reviewedBatches: 0, failures: [])
        let addressID = try await quickService.register(command, scope: scope, classification: address).get()
        check(planValue(await quickService.handle(request(.quick, addressID))) == profile.municipality + profile.locality)
        print("Profile security: schema, auth failure, scope, replay, expiry, edits, concurrent requests, cancellation and fresh commit authentication passed")
    }
}
