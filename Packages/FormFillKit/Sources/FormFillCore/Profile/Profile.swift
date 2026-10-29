import Foundation

public struct Profile: Codable, Equatable, ProfileValues {
    public var id = UUID().uuidString
    public var revision = UUID().uuidString
    public var family = ""
    public var given = ""
    public var familyKana = ""
    public var givenKana = ""
    public var postal = ""
    public var prefecture = "東京都"
    public var municipality = ""
    public var locality = ""
    public var street = ""
    public var building = ""

    public init() {}

    public static let prefectures = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]

    public func validated() throws -> Profile {
        let components = [family, given, familyKana, givenKana, postal, prefecture, municipality, locality, street, building]
        guard UUID(uuidString: id) != nil, UUID(uuidString: revision) != nil,
              components.allSatisfy({ $0.utf16.count <= 80 && $0.rangeOfCharacter(from: .controlCharacters) == nil }),
              [family, given, familyKana, givenKana, municipality, street].allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              postal.range(of: "^[0-9]{7}$", options: .regularExpression) != nil,
              Self.prefectures.contains(prefecture),
              (value(for: .address([.prefecture, .municipality, .locality, .street, .building])) ?? "").utf16.count <= 300 else { throw ProfileError.invalidProfile }
        return self
    }
}

public struct ProfileVault: Codable {
    public var schemaVersion = 1
    public var profiles: [Profile]
    public var activeProfileID: String?

    public init(profiles: [Profile], activeProfileID: String?) {
        self.profiles = profiles
        self.activeProfileID = activeProfileID
    }

    public func activeProfile() throws -> Profile {
        guard schemaVersion == 1, profiles.count == 1,
              let profile = profiles.first, activeProfileID == profile.id else { throw ProfileError.invalidStore }
        do { return try profile.validated() }
        catch { throw ProfileError.invalidStore }
    }
}

public enum ProfileError: Error, LocalizedError {
    case authentication, missing, invalidProfile, invalidStore, changed, storage
    public var errorDescription: String? {
        switch self {
        case .authentication: return "認証を完了できませんでした。端末パスコードの設定とFace IDの許可を確認し、再試行してください。"
        case .missing: return "プロフィールが未登録です。Form Fillアプリの設定から登録してください。"
        case .invalidProfile: return "姓名・カナ・市区町村・番地を入力し、郵便番号を半角7桁にしてください。各項目は80文字以内、住所全体は300文字以内です。"
        case .invalidStore: return "保存データを読み取れません。自動で上書きはしません。削除して再登録できます。"
        case .changed: return "プロフィールが変更されました。もう一度開いて確認してください。"
        case .storage: return "安全な保存領域にアクセスできませんでした。再試行してください。"
        }
    }
    public var code: String {
        switch self {
        case .authentication: return "authentication_failed"
        case .missing: return "profile_missing"
        case .invalidProfile: return "invalid_profile"
        case .invalidStore: return "profile_unreadable"
        case .changed: return "profile_changed"
        case .storage: return "storage_unavailable"
        }
    }
}
