import FormFillCore
import Foundation

/// Authenticated operations exposed to presentation code; no raw vault reads.
public struct ProfileEditingClient {
    public var open: () async throws -> Profile?
    public var save: (Profile, Profile?) async throws -> Profile
    public var delete: () async throws -> Void
    public init(open: @escaping () async throws -> Profile?,
                save: @escaping (Profile, Profile?) async throws -> Profile,
                delete: @escaping () async throws -> Void) {
        self.open = open
        self.save = save
        self.delete = delete
    }
}
