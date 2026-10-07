import FormFillCore
import FormFillApplication
import Foundation
import Security
import LocalAuthentication

/// The Apple adapter keeps the same context for explicit authentication and Keychain access.
public struct ProfileAuthenticationClient {
    public var makeContext: () -> LAContext
    public var authenticate: (LAContext) async throws -> Void

    public init(makeContext: @escaping () -> LAContext, authenticate: @escaping (LAContext) async throws -> Void) {
        self.makeContext = makeContext
        self.authenticate = authenticate
    }

    public static let live = ProfileAuthenticationClient(makeContext: {
        let context = LAContext()
        context.localizedReason = "保存した姓名・住所を使用します"
        return context
    }, authenticate: { context in
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthentication,
                localizedReason: context.localizedReason) else { throw ProfileError.authentication }
        } catch { throw ProfileError.authentication }
    })
}

/// Narrow byte-store seam for repository policy tests. The live implementation always uses Keychain ACLs.
public struct ProfileKeychainClient {
    public var read: (LAContext) throws -> Data?
    public var write: (Data, Bool, LAContext) throws -> Void
    public var delete: (LAContext) throws -> Void

    public init(read: @escaping (LAContext) throws -> Data?,
                write: @escaping (Data, Bool, LAContext) throws -> Void,
                delete: @escaping (LAContext) throws -> Void) {
        self.read = read
        self.write = write
        self.delete = delete
    }

    public static func live(accessGroup: @escaping () throws -> String) -> Self {
        func query(_ context: LAContext) throws -> [String: Any] {
            [kSecClass as String: kSecClassGenericPassword,
             kSecAttrService as String: "dev.formfill.profile-vault.v1",
             kSecAttrAccount as String: "profiles",
             kSecAttrAccessGroup as String: try accessGroup(),
             kSecAttrSynchronizable as String: false,
             kSecUseAuthenticationContext as String: context]
        }
        return Self(read: { context in
            var attributes = try query(context)
            attributes[kSecReturnData as String] = true
            attributes[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(attributes as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            try check(status)
            guard let data = result as? Data else { throw ProfileError.invalidStore }
            return data
        }, write: { data, exists, context in
            var attributes = try query(context)
            if exists {
                try check(SecItemUpdate(attributes as CFDictionary, [kSecValueData as String: data] as CFDictionary))
            } else {
                guard let access = SecAccessControlCreateWithFlags(nil,
                    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) else { throw ProfileError.storage }
                attributes[kSecAttrAccessControl as String] = access
                attributes[kSecValueData as String] = data
                try check(SecItemAdd(attributes as CFDictionary, nil))
            }
        }, delete: { context in
            let status = SecItemDelete(try query(context) as CFDictionary)
            if status != errSecItemNotFound { try check(status) }
        })
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

/// Authenticated repository policy. No defaults, files, or synchronizable profile copy.
public struct KeychainProfileRepository {
    private static let maximumBytes = 16 * 1024
    private let authentication: ProfileAuthenticationClient
    private let keychain: ProfileKeychainClient

    public init(authentication: ProfileAuthenticationClient, keychain: ProfileKeychainClient) {
        self.authentication = authentication
        self.keychain = keychain
    }

    public static let live = Self(authentication: .live, keychain: .live(accessGroup: {
        // Expanded from AppIdentifierPrefix by Xcode; never guess a signing team.
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ProfileKeychainAccessGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw ProfileError.storage }
        return group
    }))

    public var editingClient: ProfileEditingClient {
        ProfileEditingClient(open: { try await openForEditing() },
            save: { try await save($0, expected: $1) }, delete: { try await delete() })
    }

    private func read(_ context: LAContext) throws -> Profile? {
        guard let data = try keychain.read(context) else { return nil }
        guard data.count <= Self.maximumBytes,
              let vault = try? JSONDecoder().decode(ProfileVault.self, from: data) else { throw ProfileError.invalidStore }
        return try vault.activeProfile()
    }

    /// Every invocation explicitly authenticates, even when the context was used earlier.
    public func load(context: LAContext) async throws -> Profile {
        try await authentication.authenticate(context)
        return try await Task.detached {
            guard let profile = try read(context) else { throw ProfileError.missing }
            return profile
        }.value
    }

    public func openForEditing() async throws -> Profile? {
        let context = authentication.makeContext()
        defer { context.invalidate() }
        try await authentication.authenticate(context)
        return try await Task.detached { try read(context) }.value
    }

    public func save(_ candidate: Profile, expected: Profile?) async throws -> Profile {
        var profile = try candidate.validated()
        profile.revision = UUID().uuidString
        let context = authentication.makeContext()
        defer { context.invalidate() }
        try await authentication.authenticate(context)
        return try await Task.detached {
            let current = try read(context)
            guard current?.id == expected?.id, current?.revision == expected?.revision,
                  current == nil || current?.id == profile.id else { throw ProfileError.changed }
            let vault = ProfileVault(profiles: [profile], activeProfileID: profile.id)
            let data = try JSONEncoder().encode(vault)
            guard data.count <= Self.maximumBytes else { throw ProfileError.invalidProfile }
            try keychain.write(data, current != nil, context)
            return profile
        }.value
    }

    /// Reset does not decode the vault, so it also works for corrupt/unsupported schemas.
    public func delete() async throws {
        let context = authentication.makeContext()
        defer { context.invalidate() }
        try await authentication.authenticate(context)
        try await Task.detached { try keychain.delete(context) }.value
    }
}
