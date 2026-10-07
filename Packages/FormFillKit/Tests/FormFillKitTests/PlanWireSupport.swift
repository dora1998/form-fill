import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

// Existing regression assertions also exercise serialization of the typed plan.
func planWire(fields: [FormField], kinds: [String: FieldKind], sources: [String: String], modelFailed: Bool, profile: any ProfileValues) -> [String: Any] {
    BridgeResponses.plan(FillPlanner.plan(fields: fields, kinds: kinds, sources: sources, modelFailed: modelFailed, profile: profile))
}
