import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import Foundation

@MainActor final class EditingFake {
    var profile: Profile?
    var error: Error?
    var savedExpected: Profile?
    var opens = 0
    var writes = 0
    var deletes = 0
    var pending: CheckedContinuation<Profile?, Error>?
    var suspended = false

    var client: ProfileEditingClient {
        ProfileEditingClient(open: {
            self.opens += 1
            if self.suspended { return try await withCheckedThrowingContinuation { self.pending = $0 } }
            if let error = self.error { throw error }
            return self.profile
        }, save: { profile, expected in
            if let error = self.error { throw error }
            self.savedExpected = expected
            self.profile = profile
            self.writes += 1
            return profile
        }, delete: {
            if let error = self.error { throw error }
            self.profile = nil
            self.deletes += 1
        })
    }
}

@MainActor final class AppServiceTests: XCTestCase {
    func testRegression() async throws {
        let fake = EditingFake()
        var profile = Profile()
        profile.family = "試験"
        fake.profile = profile
        let editor = ProfileEditorModel(client: fake.client)
        await editor.open().value
        precondition(editor.unlocked && editor.draft == profile)
        editor.draft.given = "編集"
        fake.error = ProfileError.changed
        await editor.save().value
        precondition(editor.unlocked && editor.status == ProfileError.changed.localizedDescription)
        precondition(fake.writes == 0)
        fake.error = nil
        await editor.save().value
        precondition(!editor.unlocked && fake.writes == 1 && fake.savedExpected == profile)
        precondition(editor.draft.family.isEmpty)

        // No suspension occurs between enqueue and lock: the old view-created Task
        // captured the generation too late and could reopen a disappeared screen.
        let opens = fake.opens
        let queuedOpen = editor.open()
        precondition(editor.busy)
        editor.lock()
        await queuedOpen.value
        precondition(!editor.unlocked && !editor.busy && fake.opens == opens)
        await editor.open().value
        let writes = fake.writes
        let queuedSave = editor.save()
        editor.lock()
        await queuedSave.value
        precondition(!editor.unlocked && !editor.busy && fake.writes == writes)
        let deletes = fake.deletes
        let queuedDelete = editor.delete()
        editor.lock()
        await queuedDelete.value
        precondition(!editor.unlocked && !editor.busy && fake.deletes == deletes)

        fake.suspended = true
        let opening = editor.open()
        while fake.pending == nil { await Task.yield() }
        editor.lock()
        fake.pending?.resume(returning: profile)
        fake.pending = nil
        await opening.value
        precondition(!editor.unlocked && editor.draft.family.isEmpty && !editor.busy)
        // A late failure must not restore an error message after the screen locks either.
        let failingOpen = editor.open()
        while fake.pending == nil { await Task.yield() }
        editor.lock()
        fake.pending?.resume(throwing: ProfileError.authentication)
        fake.pending = nil
        await failingOpen.value
        precondition(editor.status.isEmpty && !editor.unlocked)
        fake.suspended = false
        fake.error = ProfileError.authentication
        await editor.open().value
        precondition(!editor.unlocked && editor.status == ProfileError.authentication.localizedDescription)
        fake.error = nil
        await editor.open().value
        await editor.delete().value
        precondition(!editor.unlocked && fake.deletes == 1 && fake.profile == nil)

        let raw = "{\"schemaVersion\":1,\"product\":\"Form Fill developer diagnostics\",\"value\":\"試験\"}"
        var authenticationCalls = 0
        var saved: RedactedDeveloperReport?
        var denied = true
        let service = SaveDeveloperReportService(loadProfile: {
            authenticationCalls += 1
            if denied { throw ProfileError.authentication }
            return profile
        }, persist: { saved = $0 })
        do { try await service.run("{}"); preconditionFailure("invalid report") }
        catch DeveloperReportError.invalidReport {}
        do { try await service.run("not-json"); preconditionFailure("malformed report") }
        catch DeveloperReportError.invalidReport {}
        do {
            try await service.run(String(repeating: "x", count: DeveloperReport.maximumBytes + 1))
            preconditionFailure("oversized report")
        } catch DeveloperReportError.tooLarge {}
        precondition(authenticationCalls == 0 && saved == nil)
        do { try await service.run(raw); preconditionFailure("authentication accepted") }
        catch ProfileError.authentication {}
        precondition(saved == nil)
        denied = false
        try await service.run(raw)
        precondition(authenticationCalls == 2 && saved != nil && !saved!.json.contains("試験"))

        let failingStore = SaveDeveloperReportService(loadProfile: { profile }, persist: { _ in throw ProfileError.storage })
        do { try await failingStore.run(raw); preconditionFailure("storage error swallowed") }
        catch ProfileError.storage {}

        let first = URL(fileURLWithPath: "/reports/first.json")
        let second = URL(fileURLWithPath: "/reports/second.json")
        var entries = [first, second]
        var reads = [URL]()
        let reports = DebugReportsModel(repository: ReportRepository(list: { entries }, read: {
            reads.append($0)
            return Data("report".utf8)
        }, delete: { urls in
            entries.removeAll { urls.contains($0) }
        }))
        await reports.refresh()
        precondition(reports.reports == [first, second])
        let exported = await reports.export(first)
        precondition(exported == Data("report".utf8) && reads == [first])
        await reports.delete([first])
        precondition(reports.reports == [second] && !reports.busy)
        let failingReports = DebugReportsModel(repository: ReportRepository(list: { entries }, read: { _ in throw ProfileError.storage }, delete: { urls in
            entries.removeAll { urls.contains($0) }
            throw ProfileError.storage
        }))
        await failingReports.refresh()
        let failedExport = await failingReports.export(second)
        precondition(failedExport == nil && failingReports.message != nil && !failingReports.busy)
        await failingReports.delete([second])
        precondition(failingReports.reports.isEmpty && failingReports.message != nil && !failingReports.busy)
        print("App services: stale authentication, editing, conflict, deletion, masked save and report CRUD passed")
    }
}
