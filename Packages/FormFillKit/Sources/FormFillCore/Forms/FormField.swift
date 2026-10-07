import Foundation

public struct FormField: Codable {
    public struct Option: Codable {
        public let value: String
        public let text: String
        public let disabled: Bool
        public init(value: String, text: String, disabled: Bool) {
            self.value = value
            self.text = text
            self.disabled = disabled
        }
    }
    public let id: String
    public var groupID: String? = nil
    public let tag: String
    public let type: String
    public let label: String
    public let ariaLabel: String
    public let name: String
    public let htmlID: String
    public let placeholder: String
    public let autocomplete: String
    public let context: String
    public let maxLength: Int
    public let pattern: String
    public let occupied: Bool
    public let options: [Option]

    public init(id: String, groupID: String? = nil, tag: String, type: String, label: String, ariaLabel: String, name: String, htmlID: String, placeholder: String, autocomplete: String, context: String, maxLength: Int, pattern: String, occupied: Bool, options: [Option]) {
        self.id = id
        self.groupID = groupID
        self.tag = tag
        self.type = type
        self.label = label
        self.ariaLabel = ariaLabel
        self.name = name
        self.htmlID = htmlID
        self.placeholder = placeholder
        self.autocomplete = autocomplete
        self.context = context
        self.maxLength = maxLength
        self.pattern = pattern
        self.occupied = occupied
        self.options = options
    }

    public var hint: String { [label, ariaLabel, name, htmlID, placeholder, context].joined(separator: " ").lowercased() }
    public var isPostalControl: Bool { autocomplete.split(separator: " ").contains("postal-code") || (name + " " + htmlID).range(of: "zip|postal|postcode|郵便番号", options: [.regularExpression, .caseInsensitive]) != nil || (label + " " + ariaLabel).contains("郵便番号") }
    public var displayLabel: String { [label, ariaLabel, placeholder, name, htmlID].first(where: { !$0.isEmpty }) ?? id }
    public var numberedAddressLine: Int? {
        let text = [label, ariaLabel, placeholder, autocomplete].joined(separator: " ")
            .folding(options: .widthInsensitive, locale: Locale(identifier: "en_US_POSIX"))
        let pattern = "(?:住所|address[-_ ]?line)\\s*([123])(?![0-9])"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        let numbers = Set(matches.compactMap { match -> Int? in
            guard let range = Range(match.range(at: 1), in: text) else { return nil }
            return Int(text[range])
        })
        return numbers.count == 1 ? numbers.first : nil
    }
    public var isPrefectureSelect: Bool {
        tag == "select" && options.filter {
            $0.text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: "^(東京都|北海道|京都府|大阪府|.{2,3}県)$", options: .regularExpression) != nil
        }.count >= 2
    }
}

public enum AddressComponent: String, Codable, CaseIterable {
    // Canonical output order belongs to the app, never to model array order.
    case prefecture, municipality, locality, street, building
}

public enum FieldKind: Equatable {
    case family, given, fullName, familyKana, givenKana, fullKana
    case postal, postalFirst3, postalLast4
    case address([AddressComponent])
    case unknown

    public static let nonAddressKinds: [FieldKind] = [.family, .given, .fullName, .familyKana, .givenKana, .fullKana,
        .postal, .postalFirst3, .postalLast4, .unknown]
    public static let permittedKinds = nonAddressKinds.map(\.rawValue) + ["address"]

    public var rawValue: String {
        switch self {
        case .family: return "family"
        case .given: return "given"
        case .fullName: return "fullName"
        case .familyKana: return "familyKana"
        case .givenKana: return "givenKana"
        case .fullKana: return "fullKana"
        case .postal: return "postal"
        case .postalFirst3: return "postalFirst3"
        case .postalLast4: return "postalLast4"
        case .address: return "address"
        case .unknown: return "unknown"
        }
    }
    public var components: [AddressComponent] {
        guard case let .address(parts) = self else { return [] }
        return AddressComponent.allCases.filter { parts.contains($0) }
    }
    public init?(kind: String, components: [String]) {
        guard kind == "address" else {
            guard components.isEmpty, let value = Self.nonAddressKinds.first(where: { $0.rawValue == kind }) else { return nil }
            self = value
            return
        }
        guard !components.isEmpty, components.count <= AddressComponent.allCases.count,
              Set(components).count == components.count,
              components.allSatisfy({ AddressComponent(rawValue: $0) != nil }) else { return nil }
        self = .address(AddressComponent.allCases.filter { components.contains($0.rawValue) })
    }
}
