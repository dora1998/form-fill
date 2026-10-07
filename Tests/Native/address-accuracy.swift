import Foundation

// Synthetic metadata only. Can also be compiled with the pre-migration sources
// to compare the same expected components against the former enum output.
@main struct AddressAccuracyCheck {
    struct Sample {
        let name: String
        let fields: [FormField]
        let expected: [[String]]
    }
    static func field(_ label: String, _ example: String = "", _ autocomplete: String = "", group: String = "g0") -> FormField {
        FormField(id: "", groupID: group, tag: "input", type: "text", label: label, ariaLabel: "",
            name: "", htmlID: "", placeholder: example, autocomplete: autocomplete, context: "",
            maxLength: 0, pattern: "", occupied: false, options: [])
    }
    static let samples = [
        Sample(name: "ward-town-without-suffix", fields: [
            field("市区町村名", "例）架空区青空", "address-level2"),
            field("丁目番地", "例）2-3-4", "address-line1"),
            field("建物名", "例）サンプルハイツ202号室", "address-line2")
        ], expected: [["municipality", "locality"], ["street"], ["building"]]),
        Sample(name: "city-ward-town-example", fields: [
            field("市区町村", "例）架空市試験区青空町", "address-level2"), field("番地", "例）2-3"), field("建物名")
        ], expected: [["municipality", "locality"], ["street"], ["building"]]),
        Sample(name: "municipality-only-example", fields: [
            field("市区町村", "例）架空区", "address-level2"),
            field("住所1", "例）青空2-3", "address-line1"), field("建物名")
        ], expected: [["municipality"], ["locality", "street"], ["building"]]),
        Sample(name: "explicit-separate-components", fields: [
            field("都道府県"), field("市区町村"), field("町名"), field("番地"), field("建物名")
        ], expected: [["prefecture"], ["municipality"], ["locality"], ["street"], ["building"]]),
        Sample(name: "generic-address-with-siblings", fields: [
            field("都道府県"), field("市区町村"), field("住所", "", "address-line1"), field("建物名")
        ], expected: [["prefecture"], ["municipality"], ["locality", "street"], ["building"]]),
        Sample(name: "address-example-with-separate-building", fields: [
            field("都道府県"), field("住所", "例）架空区青空2-3", "street-address"), field("建物名")
        ], expected: [["prefecture"], ["municipality", "locality", "street"], ["building"]]),
        Sample(name: "bare-numbered-lines", fields: [field("住所1"), field("住所2"), field("住所3")],
            expected: [["prefecture", "municipality"], ["locality", "street"], ["building"]]),
        Sample(name: "whole-address", fields: [field("住所全体")],
            expected: [["prefecture", "municipality", "locality", "street", "building"]]),
        Sample(name: "whole-address-separate-building", fields: [field("住所全体"), field("建物名")],
            expected: [["prefecture", "municipality", "locality", "street"], ["building"]]),
        Sample(name: "explicit-city-town-and-number", fields: [field("市区町村・番地"), field("建物名")],
            expected: [["municipality", "locality", "street"], ["building"]]),
        Sample(name: "unrelated-address-looking-examples", fields: [
            field("会社名", "例）青空"), field("メール", "例）架空区青空"), field("番地")
        ], expected: [[], [], ["street"]]),
        Sample(name: "independent-address-groups", fields: [
            field("市区町村名", "例）架空区青空", "shipping address-level2", group: "g0"),
            field("丁目番地", "例）2-3", "shipping address-line1", group: "g0"),
            field("市区町村", "例）試験区", "billing address-level2", group: "g1"),
            field("住所1", "例）若葉4-5", "billing address-line1", group: "g1")
        ], expected: [["municipality", "locality"], ["street"], ["municipality"], ["locality", "street"]])
    ]
    static func normalized(_ item: [String: Any]) -> [String] {
        if let parts = item["components"] as? [String] { return parts }
        // Baseline adapter is evaluation-only, never used by application code.
        return [
            "prefecture": ["prefecture"], "municipality": ["municipality"], "locality": ["locality"],
            "street": ["street"], "building": ["building"],
            "prefectureMunicipality": ["prefecture", "municipality"], "localityStreet": ["locality", "street"],
            "municipalityLocality": ["municipality", "locality"],
            "municipalityLocalityStreet": ["municipality", "locality", "street"],
            "addressWithoutPrefecture": ["municipality", "locality", "street", "building"],
            "prefectureMunicipalityLocalityStreet": ["prefecture", "municipality", "locality", "street"],
            "fullAddress": ["prefecture", "municipality", "locality", "street", "building"], "unknown": []
        ][item["kind"] as? String ?? ""] ?? ["invalid"]
    }
    static func main() async throws {
        var correct = 0, total = 0, modelFailures = 0
        for (sampleIndex, sample) in samples.enumerated() {
            if let index = CommandLine.arguments.dropFirst().compactMap(Int.init).first, sampleIndex != index { continue }
            // Reconstruct IDs in document order; no real DOM or profile data.
            var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(sample.fields)) as! [[String: Any]]
            for index in json.indices { json[index]["id"] = "f\(index)" }
            let result = await FormClassifier.analyze(["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": json, "developerDiagnostics": CommandLine.arguments.contains("--trace")])
            guard result["ok"] as? Bool == true, let items = result["classifications"] as? [[String: Any]] else {
                print("UNAVAILABLE: \(result["reason"] ?? result["error"] ?? "unknown")")
                exit(2)
            }
            if result["modelFailed"] as? Bool == true {
                modelFailures += 1
                print("Model failures: \(result["modelDiagnostics"] ?? [:])")
            }
            let byID = Dictionary(uniqueKeysWithValues: items.map { ($0["id"] as! String, $0) })
            var mistakes = [String]()
            for index in sample.expected.indices {
                total += 1
                let item = byID["f\(index)"] ?? [:]
                let actual = normalized(item)
                if Set(actual) == Set(sample.expected[index]) && (sample.expected[index].isEmpty ? item["kind"] as? String == "unknown" : true) {
                    correct += 1
                } else { mistakes.append("f\(index) kind=\(item["kind"] ?? "missing"): \(actual) expected \(sample.expected[index])") }
            }
            print("\(mistakes.isEmpty ? "PASS" : "FAIL") \(sample.name)\(mistakes.isEmpty ? "" : ": " + mistakes.joined(separator: "; "))")
            if CommandLine.arguments.contains("--trace"), let diagnostics = result["developerDiagnostics"] as? [String: Any], let trace = diagnostics["trace"] as? [[String: Any]] {
                for event in trace where event["stage"] as? String == "model_response" { print(event["response"] ?? "") }
            }
            fflush(stdout)
        }
        print("Accuracy: \(correct)/\(total) fields; \(modelFailures) samples with model failures")
        if correct != total || modelFailures > 0 { exit(1) }
    }
}
