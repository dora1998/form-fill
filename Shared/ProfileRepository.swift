import Foundation
import Security
import LocalAuthentication

/// The sole persistence boundary. No defaults, files, or synchronizable copy.
struct ProfileRepository {
    private static let service = "dev.formfill.profile-vault.v1"
    private static let account = "profiles"
    private static let maximumBytes = 16 * 1024

    private static func query() throws -> [String: Any] {
        // Expanded from AppIdentifierPrefix by Xcode; never guess a signing team.
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ProfileKeychainAccessGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw ProfileError.storage }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service, kSecAttrAccount as String: account,
                kSecAttrAccessGroup as String: group,
                kSecAttrSynchronizable as String: false]
    }

    static func context() -> LAContext {
        let context = LAContext()
        context.localizedReason = "保存した姓名・住所を使用します"
        return context
    }

    private static func authenticate(_ context: LAContext) async throws {
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthentication,
                localizedReason: "保存した姓名・住所を表示・変更します") else { throw ProfileError.authentication }
        } catch { throw ProfileError.authentication }
    }

    private static func read(_ context: LAContext) throws -> Profile? {
        var query = try query()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data, data.count <= maximumBytes,
              let vault = try? JSONDecoder().decode(ProfileVault.self, from: data) else { throw ProfileError.invalidStore }
        return try vault.activeProfile()
    }

    /// Explicitly request fresh user authentication for every preview/commit.
    /// The Keychain ACL independently protects the subsequent read.
    static func load(context: LAContext) async throws -> Profile {
        try await authenticate(context)
        return try await Task.detached { () throws -> Profile in
            guard let profile = try read(context) else { throw ProfileError.missing }
            return profile
        }.value
    }

    /// Authenticate even for an empty vault so creation is also protected.
    static func openForEditing() async throws -> Profile? {
        let context = context()
        defer { context.invalidate() }
        try await authenticate(context)
        return try await Task.detached { try read(context) }.value
    }

    static func save(_ candidate: Profile, expected: Profile?) async throws -> Profile {
        var profile = try candidate.validated()
        profile.revision = UUID().uuidString
        let context = context()
        defer { context.invalidate() }
        try await authenticate(context)
        return try await Task.detached {
            let current = try read(context)
            guard current?.id == expected?.id, current?.revision == expected?.revision,
                  current == nil || current?.id == profile.id else { throw ProfileError.changed }
            let vault = ProfileVault(profiles: [profile], activeProfileID: profile.id)
            let data = try JSONEncoder().encode(vault)
            guard data.count <= maximumBytes else { throw ProfileError.invalidProfile }
            var query = try query()
            query[kSecUseAuthenticationContext as String] = context
            if current != nil {
                try check(SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary))
            } else {
                guard let access = SecAccessControlCreateWithFlags(nil,
                    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) else { throw ProfileError.storage }
                query[kSecAttrAccessControl as String] = access
                query[kSecValueData as String] = data
                try check(SecItemAdd(query as CFDictionary, nil))
            }
            return profile
        }.value
    }

    /// Explicitly authenticated reset also works for an unsupported/corrupt schema.
    static func delete() async throws {
        let context = context()
        defer { context.invalidate() }
        try await authenticate(context)
        try await Task.detached {
            var query = try query()
            query[kSecUseAuthenticationContext as String] = context
            let status = SecItemDelete(query as CFDictionary)
            if status != errSecItemNotFound { try check(status) }
        }.value
    }

    private static func check(_ status: OSStatus) throws {
        guard status != errSecSuccess else { return }
        switch status {
        case errSecAuthFailed, errSecUserCanceled, errSecInteractionNotAllowed, errSecNotAvailable:
            throw ProfileError.authentication
        default: throw ProfileError.storage
        }
    }
}
