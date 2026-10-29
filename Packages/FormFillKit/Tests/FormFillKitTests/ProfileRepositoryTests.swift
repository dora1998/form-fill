import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import Foundation
import LocalAuthentication

final class VaultFake {
    var data: Data?
    var authenticated: LAContext?
    var authentications = 0
    var writes = 0
    var deletes = 0
    var readCalls = 0
    var denied = false
    var failWrite = false
    var inserted: Bool?

    var repository: KeychainProfileRepository {
        KeychainProfileRepository(authentication: ProfileAuthenticationClient(makeContext: { LAContext() }, authenticate: {
            self.authentications += 1
            if self.denied { throw ProfileError.authentication }
            self.authenticated = $0
        }), keychain: ProfileKeychainClient(read: {
            precondition($0 === self.authenticated)
            self.readCalls += 1
            return self.data
        }, write: { data, exists, context in
            precondition(context === self.authenticated)
            if self.failWrite { throw ProfileError.storage }
            self.writes += 1
            self.inserted = !exists
            self.data = data
        }, delete: {
            precondition($0 === self.authenticated)
            self.deletes += 1
            self.data = nil
        }))
    }
}

final class ProfileRepositoryTests: XCTestCase {
    func testRegression() async throws {
        let vault = VaultFake()
        let repository = vault.repository
        var profile = Profile()
        profile.family = "試験"; profile.given = "花子"; profile.familyKana = "シケン"; profile.givenKana = "ハナコ"
        profile.postal = "1600022"; profile.municipality = "新宿区"; profile.locality = "新宿"; profile.street = "0-0"
        let empty = try await repository.openForEditing()
        precondition(empty == nil && vault.authentications == 1)
        let saved = try await repository.save(profile, expected: nil)
        precondition(vault.inserted == true && saved.revision != profile.revision)
        let opened = try await repository.openForEditing()
        precondition(opened == saved)
        do { _ = try await repository.save(profile, expected: profile); preconditionFailure("stale save") }
        catch ProfileError.changed {}
        precondition(vault.writes == 1)
        let updated = try await repository.save(saved, expected: saved)
        precondition(vault.inserted == false && updated.revision != saved.revision)
        vault.failWrite = true
        do { _ = try await repository.save(updated, expected: updated); preconditionFailure("write failure") }
        catch ProfileError.storage {}
        vault.failWrite = false
        let reads = vault.readCalls
        vault.denied = true
        do { _ = try await repository.openForEditing(); preconditionFailure("denied read") }
        catch ProfileError.authentication {}
        do { try await repository.delete(); preconditionFailure("denied delete") }
        catch ProfileError.authentication {}
        precondition(vault.readCalls == reads && vault.deletes == 0)
        vault.denied = false
        vault.data = Data("broken vault".utf8)
        do { _ = try await repository.openForEditing(); preconditionFailure("corrupt read") }
        catch ProfileError.invalidStore {}
        try await repository.delete()
        precondition(vault.deletes == 1 && vault.data == nil)
        var invalid = profile
        invalid.postal = "not-postal"
        let attempts = vault.authentications
        do { _ = try await repository.save(invalid, expected: nil); preconditionFailure("invalid save") }
        catch ProfileError.invalidProfile {}
        precondition(vault.authentications == attempts)
        let context = LAContext()
        do { _ = try await repository.load(context: context); preconditionFailure("missing load") }
        catch ProfileError.missing {}
        print("Profile repository: authenticated context, create/update, conflict, corruption and failures passed")
    }
}
