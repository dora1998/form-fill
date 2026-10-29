import FormFillCore
import Foundation

/// Metadata-only orchestration, independent of Foundation Models and authentication.
public struct ClassificationService {
    public let model: ClassificationModelClient
    public var now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    public init(model: ClassificationModelClient, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.model = model; self.now = now
    }
    public static func coalescedBatches(_ batches: [[FormField]]) -> [[FormField]] {
        var result = [[FormField]]()
        for batch in batches {
            if let last = result.last, last.count + batch.count <= 4 { result[result.count - 1] += batch }
            else { result.append(batch) }
        }
        return result
    }
    public static func modelContextFields(_ fields: [FormField], requestedIDs: Set<String>) -> [FormField] {
        let candidates = FillPlanner.fieldGroups(fields).filter { $0.contains { requestedIDs.contains($0.id) } }
            .map { FillPlanner.siblingContext(fields: $0, requestedIDs: requestedIDs).filter { !requestedIDs.contains($0.id) } }
        var selected = Set<String>()
        // Share the context budget fairly across independent groups.
        for index in 0..<8 {
            for group in candidates where index < group.count && selected.count < 8 - requestedIDs.count {
                selected.insert(group[index].id)
            }
        }
        return fields.filter { selected.contains($0.id) }
    }
    public static func outputIssues(_ entries: [ClassifiedField], expectedIDs: [String]) -> [String] {
        guard entries.count == expectedIDs.count else { return ["count_mismatch"] }
        return FillPlanner.modelOutputIssues(ids: expectedIDs, kinds: entries.map(\.kind),
            components: entries.map(\.components), expectedIDs: expectedIDs)
    }
    public func analyze(_ command: AnalyzeCommand) async -> ClassificationOutcome {
        let requestID = command.requestID
        let fields = command.fields
        let detailed = command.developerDiagnostics
        var trace = [[String: Any]]()
        let started = now()
        func record(_ data: [String: Any]) {
            if detailed { var event = data; event["elapsedMs"] = Int((now() - started) * 1000); trace.append(event) }
        }
        func diagnostics() -> [String: Any]? {
            detailed ? ["trace": trace, "osVersion": ProcessInfo.processInfo.operatingSystemVersionString] : nil
        }
        record(["stage": "decoded", "fieldIDs": fields.map(\.id)])
        if let reason = model.unavailableReason() {
            return .unavailable(reason: reason, diagnostics: diagnostics())
        }
        var kinds = [String: FieldKind]()
        var sources = [String: String]()
        for field in fields {
            if let kind = FillPlanner.rule(for: field) { kinds[field.id] = kind; sources[field.id] = "rule" }
        }
        let addressDefaults = FillPlanner.numberedAddressDefaults(fields: fields, kinds: kinds)
        for (id, kind) in addressDefaults { kinds[id] = kind; sources[id] = "rule" }

        let contextual = FillPlanner.contextualAddressKinds(fields: fields, kinds: kinds)
        for (id, kind) in contextual where kinds[id] != kind { kinds[id] = kind; sources[id] = "rule" }
        record(["stage": "rules", "kinds": kinds.mapValues { ["kind": $0.rawValue, "components": $0.components.map(\.rawValue)] as [String: Any] }])
        let unresolved = FillPlanner.fieldsNeedingClassification(fields, kinds: kinds)

        var modelFailed = false
        var failures = [[String: Any]]()
        var attemptedBatches = 0
        // Independent small batches keep each request within the on-device context budget.
        let deadline = now() + 45
        let groups = FillPlanner.fieldGroups(fields)
        let groupByID = Dictionary(uniqueKeysWithValues: groups.enumerated().flatMap { index, group in group.map { ($0.id, "g\(index)") } })
        let batches = Self.coalescedBatches(FillPlanner.classificationBatches(fields: fields, kinds: kinds))
        var scheduled = batches.map { (fields: $0, review: false) }
        var batchIndex = 0
        var reviewedBatches = 0
        while batchIndex < scheduled.count {
            let task = scheduled[batchIndex]
            let batch = task.fields
            let currentIndex = batchIndex
            batchIndex += 1
            // Schedule one bounded review after the initial classification pass.
            defer {
                if batchIndex == batches.count {
                    scheduled += Self.coalescedBatches(FillPlanner.addressReviewBatches(fields: fields, kinds: kinds, sources: sources))
                        .map { (fields: $0, review: true) }
                }
            }
            if now() > deadline {

                modelFailed = true
                failures.append(["fieldIDs": scheduled[currentIndex...].flatMap { $0.fields.map(\.id) }, "reason": "deadline_exceeded"])
                break
            }
            attemptedBatches += 1
            if task.review { reviewedBatches += 1 }

            do {
                // Address components depend on siblings' examples, not just their labels.
                // Requested controls are emitted only once; share the remaining
                // eight-control budget among their independent groups.
                let requestedIDs = Set(batch.map(\.id))
                let contextFields = Self.modelContextFields(fields, requestedIDs: requestedIDs)
                let modelRequest = ClassificationModelRequest(fields: batch, contextFields: contextFields,
                    groupByID: groupByID, kinds: kinds, sources: sources, review: task.review)
                let prepared = try ClassificationPromptBuilder.build(modelRequest)
                let instructions = prepared.instructions
                let prompt = prepared.prompt

                record(["stage": "model_request", "batch": currentIndex, "review": task.review, "instructions": instructions, "prompt": prompt])
                let result = try await model.generate(prepared)
                record(["stage": "model_response", "batch": currentIndex, "review": task.review, "response": result.diagnosticJSON])
                let entries = result.fields
                let output = zip(batch, entries).map { (id: $0.0.id, kind: $0.1.kind, components: $0.1.components) }
                record(["stage": "decoded_response", "fields": output.map { ["id": $0.id, "kind": $0.kind, "components": $0.components] as [String: Any] }])
                let issues = Self.outputIssues(entries, expectedIDs: batch.map(\.id))

                guard issues.isEmpty else {
                    modelFailed = true

                    failures.append(["fieldIDs": batch.map(\.id), "reason": "invalid_model_output", "validationCodes": issues])
                    continue
                }
                var candidate = kinds
                for item in output { candidate[item.id] = FieldKind(kind: item.kind, components: item.components) }
                if task.review {
                    let acceptable = groups.filter { $0.contains { requestedIDs.contains($0.id) } }.allSatisfy { group in
                        let oldParts = group.reduce(into: Set<String>()) { $0.formUnion(FillPlanner.addressComponents(kinds[$1.id] ?? .unknown)) }
                        let newParts = group.reduce(into: Set<String>()) { $0.formUnion(FillPlanner.addressComponents(candidate[$1.id] ?? .unknown)) }
                        return newParts.isSuperset(of: oldParts) && FillPlanner.overlappingAddressGroups(fields: group, kinds: candidate).isEmpty
                    }
                    guard acceptable else {
                        record(["stage": "address_review_rejected", "fieldIDs": batch.map(\.id)])
                        continue
                    }
                }
                kinds = candidate
                for item in output { sources[item.id] = "model" }

            } catch {
                modelFailed = true
                // Preserve generated content when the SDK cannot decode it. record()
                // remains gated by explicit developer capture, including this path.
                if let response = (error as? ClassificationModelFailure)?.rawResponse {
                    record(["stage": "model_response", "batch": currentIndex, "review": task.review, "response": response])
                }
                record(["stage": "model_error", "batch": currentIndex, "review": task.review, "error": (error as? ClassificationModelFailure)?.diagnosticDescription ?? String(reflecting: error)])
                let reason = (error as? ClassificationModelFailure)?.code ?? "unknown"

                failures.append(["fieldIDs": batch.map(\.id), "reason": reason])
            }
        }
        kinds = FillPlanner.contextualAddressKinds(fields: fields, kinds: kinds)
        for group in FillPlanner.overlappingAddressGroups(fields: fields, kinds: kinds) {
            modelFailed = true
            failures.append(["fieldIDs": group.map(\.id), "reason": "overlapping_address_components"])

        }
        let classified = fields.map { FieldClassification(id: $0.id, kind: kinds[$0.id] ?? .unknown,
            source: sources[$0.id] ?? "unclassified", label: $0.displayLabel) }
        record(["stage": "classified", "fieldIDs": fields.map(\.id)])
        return .classified(ClassificationResult(requestID: requestID, fields: classified, modelFailed: modelFailed,
            requestedFields: unresolved.count, attemptedBatches: attemptedBatches, reviewedBatches: reviewedBatches,
            failures: failures, developerDiagnostics: diagnostics()))
    }
}
