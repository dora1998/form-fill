import Foundation

public struct FillItem {
    public let id: String
    public let label: String
    public let kind: FieldKind
    public let value: String
    public let displayValue: String
    public let source: String
    public let overwritesExisting: Bool
    public init(id: String, label: String, kind: FieldKind, value: String, displayValue: String, source: String, overwritesExisting: Bool) {
        self.id = id
        self.label = label
        self.kind = kind
        self.value = value
        self.displayValue = displayValue
        self.source = source
        self.overwritesExisting = overwritesExisting
    }
}

public struct SkippedField {
    public let id: String
    public let label: String
    public let reason: SkipReason
    public let kind: FieldKind
    public let source: String
    public init(id: String, label: String, reason: SkipReason, kind: FieldKind, source: String) {
        self.id = id
        self.label = label
        self.reason = reason
        self.kind = kind
        self.source = source
    }
}

public struct FillPlan {
    public let profileID: String
    public let items: [FillItem]
    public let skipped: [SkippedField]
    public let modelFailed: Bool
    public init(profileID: String, items: [FillItem], skipped: [SkippedField], modelFailed: Bool) {
        self.profileID = profileID
        self.items = items
        self.skipped = skipped
        self.modelFailed = modelFailed
    }
}

public enum SkipReason: String {
    case emptyProfile = "empty_profile", valueTooLong = "value_too_long", unclassified
    case noMatchingOption = "no_matching_option", patternConstraint = "pattern_constraint"
    case lengthConstraint = "length_constraint", numberConstraint = "number_constraint"
    case groupOverlap = "group_overlap", addressOverlap = "address_overlap"

}
