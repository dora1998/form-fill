import Foundation

public protocol ProfileValues {
    var id: String { get }
    var family: String { get }
    var given: String { get }
    var familyKana: String { get }
    var givenKana: String { get }
    var postal: String { get }
    var prefecture: String { get }
    var municipality: String { get }
    var locality: String { get }
    var street: String { get }
    var building: String { get }
}

public extension ProfileValues {
    func value(for kind: FieldKind) -> String? {
        switch kind {
        case .family: return family
        case .given: return given
        case .fullName: return family + " " + given
        case .familyKana: return familyKana
        case .givenKana: return givenKana
        case .fullKana: return familyKana + " " + givenKana
        case .postal: return postal
        case .postalFirst3: return String(postal.prefix(3))
        case .postalLast4: return String(postal.suffix(4))
        case .address(let parts):
            guard !parts.isEmpty, Set(parts).count == parts.count else { return nil }
            return AddressComponent.allCases.filter { parts.contains($0) }.map { part in
                switch part {
                case .prefecture: return prefecture
                case .municipality: return municipality
                case .locality: return locality
                case .street: return street
                case .building: return (parts.count > 1 ? " " : "") + building
                }
            }.joined()
        case .unknown: return nil
        }
    }
}
