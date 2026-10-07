import FormFillCore
import Foundation
import Observation

@MainActor @Observable
public final class ProfileEditorModel {
    public var draft = Profile()
    public private(set) var unlocked = false
    public private(set) var busy = false
    public private(set) var status = ""
    private var original: Profile?
    private var generation = UUID()
    private let client: ProfileEditingClient

    public init(client: ProfileEditingClient) { self.client = client }

    /// Discards presentation results. An already authorized save/delete may finish.
    public func lock() {
        generation = UUID()
        unlocked = false
        draft = Profile()
        original = nil
        status = ""
    }

    /// Capture state synchronously, before the UI can disappear or lock while work is queued.
    @discardableResult
    public func open() -> Task<Void, Never> {
        guard !busy else { return Task {} }
        busy = true
        status = ""
        let token = generation
        return Task { [self] in
            defer { busy = false }
            guard generation == token else { return }
            do {
                let profile = try await client.open()
                guard generation == token else { return }
                original = profile
                draft = profile ?? Profile()
                unlocked = true
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "開けませんでした。再試行してください。"
            }
        }
    }

    @discardableResult
    public func save() -> Task<Void, Never> {
        guard !busy, unlocked else { return Task {} }
        let candidate = draft
        let expected = original
        busy = true
        status = ""
        let token = generation
        return Task { [self] in
            defer { busy = false }
            guard generation == token else { return }
            do {
                _ = try await client.save(candidate, expected)
                guard generation == token else { return }
                lock()
                status = "保存しました。SafariのForm Fillから利用できます。"
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "保存できませんでした。再試行してください。"
            }
        }
    }

    @discardableResult
    public func delete() -> Task<Void, Never> {
        guard !busy else { return Task {} }
        lock()
        busy = true
        let token = generation
        return Task { [self] in
            defer { busy = false }
            guard generation == token else { return }
            do {
                try await client.delete()
                guard generation == token else { return }
                status = "プロフィールを削除しました。"
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "削除できませんでした。再試行してください。"
            }
        }
    }
}
