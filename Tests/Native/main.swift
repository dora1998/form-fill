import Foundation

func field(_ label: String, autocomplete: String = "", length: Int = 0, occupied: Bool = false, options: [FormField.Option] = [], pattern: String = "", context: String = "", name: String = "", type: String = "text", placeholder: String = "", id: String = "f0", groupID: String? = nil) -> FormField {
    FormField(id: id, groupID: groupID, tag: options.isEmpty ? "input" : "select", type: options.isEmpty ? type : "select-one", label: label, ariaLabel: "", name: name, htmlID: "", placeholder: placeholder, autocomplete: autocomplete, context: context, maxLength: length, pattern: pattern, occupied: occupied, options: options)
}
func plan(_ field: FormField, _ kind: FieldKind) -> [String: Any] {
    FillPlanner.plan(fields: [field], kinds: ["f0": kind], sources: ["f0": "rule"], modelFailed: false)
}
func value(_ field: FormField, _ kind: FieldKind) -> String? { (plan(field, kind)["items"] as? [[String: Any]])?.first?["value"] as? String }
assert(FillPlanner.rule(for: field("姓")) == .family)
assert(FillPlanner.rule(for: field("セイ")) == .familyKana)
assert(FillPlanner.rule(for: field("姓（ふりがな）")) == .familyKana)
assert(FillPlanner.rule(for: field("町名・番地", autocomplete: "address-line1")) == .localityStreet)
assert(FillPlanner.rule(for: field("住所1", autocomplete: "address-line1")) == nil)
assert(FillPlanner.rule(for: field("郵便番号", length: 3)) == .postalFirst3)
assert(value(field("せい"), .familyKana) == "やまだ")
assert(value(field("番地"), .street) == "1-1")
assert(value(field("町名・番地"), .localityStreet) == "千代田1-1")
assert(value(field("郵便番号"), .postal) == "100-0001")
assert(value(field("郵便番号", length: 7), .postal) == "1000001")
assert(value(field("郵便番号", pattern: "[0-9]{7}"), .postal) == "1000001")
assert(value(field("郵便番号", pattern: "[0-9]{3}-[0-9]{4}"), .postal) == "100-0001")
assert(value(field("姓", length: 1), .family) == nil)
assert(value(field("姓", occupied: true), .family) == "山田")
assert(value(field("不明"), .unknown) == nil)
assert(value(field("都道府県", options: [.init(value: "13", text: "東京都", disabled: false)]), .prefecture) == "13")
assert(value(field("都道府県", options: [.init(value: "13", text: "大阪府", disabled: false)]), .prefecture) == nil)
assert(value(field("都道府県", options: [.init(value: "13", text: "東京都", disabled: true)]), .prefecture) == nil)
let valid: [String: Any] = ["version": 1, "type": "analyzeForm", "requestID": UUID().uuidString, "fields": try! JSONSerialization.jsonObject(with: JSONEncoder().encode([field("姓")]))]
assert(FillPlanner.decode(valid) != nil)
var invalid = valid; invalid["requestID"] = "not-a-uuid"; assert(FillPlanner.decode(invalid) == nil)
invalid = valid; invalid["fields"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode([field("姓"), field("名")]))
assert(FillPlanner.decode(invalid) == nil)
assert(FillPlanner.rule(for: field("住所1（町名・番地）")) == .localityStreet)
assert(FillPlanner.rule(for: field("住所1（市区町村・町名・番地）")) == .municipalityLocalityStreet)
assert(FillPlanner.rule(for: field("住所2（建物名・部屋番号）")) == .building)
assert(FillPlanner.rule(for: field("姓", context: "フリガナ")) == .familyKana)
assert(FillPlanner.rule(for: field("名", context: "フリガナ")) == .givenKana)
assert(FillPlanner.rule(for: field("フリガナ(姓)")) == .familyKana)
assert(FillPlanner.rule(for: field("お名前(名)")) == .given)
assert(FillPlanner.rule(for: field("", length: 4, name: "c_f_zip_no[1]")) == .postalLast4)
assert(FillPlanner.rule(for: field("市区町村・番地")) == .municipalityLocalityStreet)
assert(FillPlanner.rule(for: field("住所（都道府県）")) == .prefecture)
assert(FillPlanner.rule(for: field("市区町村", placeholder: "例) 京都市右京区西院巽町")) == .municipalityLocality)
assert(value(field("市区町村"), .municipalityLocality) == "千代田区千代田")
assert(value(field("ご住所", name: "zip", type: "tel"), .postal) == "1000001")
invalid = valid; invalid["fields"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode([field("ご住所", name: "zip", type: "tel")]))
assert(FillPlanner.decode(invalid) != nil)
invalid["fields"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode([field("電話番号", name: "tel", type: "tel")]))
assert(FillPlanner.decode(invalid) == nil)
assert(FillPlanner.rule(for: field("住所（市区町村郡以降） 例：山形市清住町3-2-45")) == .addressWithoutPrefecture)
assert(FillPlanner.rule(for: field("市区町村", placeholder: "例：千代田区")) == nil)
assert(FillPlanner.rule(for: field("ご連絡先の電話番号 例：022-123-4567")) == .unknown)
assert(FillPlanner.rule(for: field("メールアドレス")) == .unknown)
assert(FillPlanner.rule(for: field("会社名")) == .unknown)
assert(FillPlanner.rule(for: field("お問い合わせ内容")) == .unknown)
let prefectures: [FormField.Option] = [.init(value: "13", text: "東京都", disabled: false), .init(value: "14", text: "神奈川県", disabled: false)]
assert(FillPlanner.rule(for: field("", occupied: true, options: prefectures)) == .prefecture)
assert(value(field("都道府県", occupied: true, options: prefectures), .prefecture) == "13")
assert(value(field("市区町村", occupied: true), .municipality) == "千代田区")
assert(value(field("選択", occupied: true, options: [.init(value: "x", text: "その他", disabled: false)]), .prefecture) == nil)
let overwriteOccupied = (plan(field("市区町村", occupied: true), .municipality)["items"] as! [[String: Any]])[0]
assert(overwriteOccupied["kind"] as? String == "municipality")
assert(overwriteOccupied["source"] as? String == "rule")
assert(overwriteOccupied["overwritesExisting"] as? Bool == true)
let notClassified = FillPlanner.plan(fields: [field("住所", occupied: true)], kinds: [:], sources: [:], modelFailed: false)
let skippedUnclassified = (notClassified["skipped"] as! [[String: String]])[0]
assert(skippedUnclassified["kind"] == "unknown")
assert(skippedUnclassified["source"] == "unclassified")
assert(FillPlanner.fieldsNeedingClassification([field("住所1", occupied: true)], kinds: [:]).count == 1)
assert(FillPlanner.fieldsNeedingClassification([field("住所1")], kinds: [:]).count == 1)
assert(FillPlanner.fieldsNeedingClassification([field("姓", occupied: true)], kinds: ["f0": .family]).isEmpty)
let classifiedOccupied = FillPlanner.plan(fields: [field("住所1", length: 1, occupied: true)], kinds: ["f0": .municipalityLocalityStreet], sources: ["f0": "model"], modelFailed: false)
assert((classifiedOccupied["items"] as! [[String: Any]]).isEmpty)
assert((classifiedOccupied["skipped"] as! [[String: String]])[0]["source"] == "model")
assert((classifiedOccupied["skipped"] as! [[String: String]])[0]["reason"] == "文字数制限に合いません")
let validOccupied = FillPlanner.plan(fields: [field("住所1", occupied: true)], kinds: ["f0": .municipalityLocalityStreet], sources: ["f0": "model"], modelFailed: false)
assert((validOccupied["items"] as! [[String: Any]])[0]["value"] as? String == "千代田区千代田1-1")
assert((validOccupied["items"] as! [[String: Any]])[0]["overwritesExisting"] as? Bool == true)
let expectedIDs = ["f1", "f2", "f3"]
assert(FillPlanner.modelOutputIssues(ids: expectedIDs, kinds: ["fullAddress", "building", "unknown"], expectedIDs: expectedIDs).isEmpty)
assert(FillPlanner.modelOutputIssues(ids: ["f0", "f1", "f2"], kinds: ["fullAddress", "building", "unknown"], expectedIDs: expectedIDs) == ["unexpected_ids", "missing_ids"])
assert(FillPlanner.modelOutputIssues(ids: ["f1", "f1"], kinds: ["fullAddress", "unknown"], expectedIDs: expectedIDs) == ["count_mismatch", "duplicate_ids", "missing_ids"])
assert(FillPlanner.modelOutputIssues(ids: expectedIDs, kinds: ["private-address", "building", "unknown"], expectedIDs: expectedIDs) == ["invalid_kind"])
assert(FillPlanner.safeModelIDs(["f1", "f2", "private-person-name"]) == ["f1", "f2", "invalid"])
assert(FillPlanner.safeModelKinds(["postal", "private-person-address"]) == ["postal", "invalid"])
let numbered = (1...3).map { field("住所", length: 50, occupied: true, placeholder: "住所\($0)", id: "f\($0)") }
assert(field("住所", placeholder: "住所１（必須）").numberedAddressLine == 1)
assert(field("住所", autocomplete: "address-line2").numberedAddressLine == 2)
assert(field("住所", placeholder: "住所12").numberedAddressLine == nil)
assert(field("住所1", placeholder: "住所2").numberedAddressLine == nil)
assert(FillPlanner.numberedAddressGroups(numbered).count == 1)
let duplicateAddress = Dictionary(uniqueKeysWithValues: numbered.map { ($0.id, FieldKind.addressWithoutPrefecture) })
let repeatedPlan = FillPlanner.plan(fields: numbered, kinds: duplicateAddress, sources: [:], modelFailed: true)
assert((repeatedPlan["items"] as! [[String: Any]]).isEmpty)
assert((repeatedPlan["skipped"] as! [[String: String]]).allSatisfy { $0["reason"] == "住所欄の構成が重複しています" })
assert(FillPlanner.overlappingAddressGroups(fields: numbered, kinds: ["f1": .municipalityLocality, "f2": .street, "f3": .building]).isEmpty)
assert(FillPlanner.overlappingAddressGroups(fields: numbered, kinds: ["f1": .municipalityLocalityStreet, "f2": .street, "f3": .building]).count == 1)
let independent = [field("住所1", id: "f1"), field("住所2", id: "f2"), field("住所1", id: "f3"), field("住所2", id: "f4")]
assert(FillPlanner.numberedAddressGroups(independent).map { $0.map(\.id) } == [["f1", "f2"], ["f3", "f4"]])
assert(FillPlanner.overlappingAddressGroups(fields: independent, kinds: ["f1": .municipalityLocalityStreet, "f2": .building, "f3": .municipalityLocalityStreet, "f4": .building]).isEmpty)
let defaults = FillPlanner.numberedAddressDefaults(fields: numbered, kinds: [:])
assert(defaults == ["f1": .prefectureMunicipality, "f2": .localityStreet, "f3": .building])
let defaultPlan = FillPlanner.plan(fields: numbered, kinds: defaults, sources: [:], modelFailed: false)
assert((defaultPlan["items"] as! [[String: Any]]).map { $0["value"] as! String } == ["東京都千代田区", "千代田1-1", "テストマンション101号室"])
assert((defaultPlan["items"] as! [[String: Any]]).allSatisfy { $0["overwritesExisting"] as? Bool == true })
assert(FillPlanner.numberedAddressDefaults(fields: Array(numbered.prefix(2)), kinds: [:]).isEmpty)
let described = [field("住所1", placeholder: "例：京都市右京区", id: "f1"), numbered[1], numbered[2]]
assert(FillPlanner.numberedAddressDefaults(fields: described, kinds: [:]).isEmpty)
let separateRegion = [field("都道府県", id: "f0")] + numbered
assert(FillPlanner.numberedAddressDefaults(fields: separateRegion, kinds: ["f0": .prefecture]).isEmpty)
assert(FillPlanner.numberedAddressDefaults(fields: numbered, kinds: ["f2": .street]).isEmpty)
assert(FillPlanner.overlappingAddressGroups(fields: numbered, kinds: defaults).isEmpty)

// Semantic headings support tel postal inputs with opaque identifiers.
let semanticPostal = field("郵便番号", length: 7, name: "code", type: "tel")
invalid = valid; invalid["fields"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode([semanticPostal]))
assert(FillPlanner.decode(invalid) != nil)
assert(FillPlanner.rule(for: semanticPostal) == .postal)
assert(value(semanticPostal, .postal) == "1000001")
assert(FillPlanner.rule(for: field("番地", placeholder: "例）4-9")) == .street)
assert(FillPlanner.rule(for: field("方書・マンション名", placeholder: "例）テストハイツ510号室")) == .building)
// Each structural group owns a complete, complementary address independently.
let checkout = ["g0", "g1"].enumerated().flatMap { index, group in
    [field("姓", id: "f\(index * 6)", groupID: group),
     field("名", id: "f\(index * 6 + 1)", groupID: group),
     field("都道府県", id: "f\(index * 6 + 2)", groupID: group),
     field("市区町村", id: "f\(index * 6 + 3)", groupID: group),
     field("住所", autocomplete: index == 0 ? "shipping address-line1" : "billing address-line1", id: "f\(index * 6 + 4)", groupID: group),
     field("建物名、部屋番号など (任意)", id: "f\(index * 6 + 5)", groupID: group)]
}
let checkoutRules = Dictionary(uniqueKeysWithValues: checkout.compactMap { f in FillPlanner.rule(for: f).map { (f.id, $0) } })
assert(checkoutRules["f4"] == nil)
let checkoutKinds = FillPlanner.contextualAddressKinds(fields: checkout, kinds: checkoutRules)
assert(checkoutKinds["f4"] == .localityStreet && checkoutKinds["f10"] == .localityStreet)
assert(FillPlanner.classificationBatches(fields: checkout, kinds: [:]).map { $0.count } == [4, 2, 4, 2])
assert(FillPlanner.classificationBatches(fields: checkout, kinds: checkoutRules).map { $0.map(\.id) } == [["f4"], ["f10"]])
assert(FillPlanner.siblingContext(fields: checkout, requestedIDs: ["f10"]).allSatisfy { $0.groupID == "g1" })
let checkoutPlan = FillPlanner.plan(fields: checkout, kinds: checkoutRules, sources: [:], modelFailed: false)
assert((checkoutPlan["items"] as! [[String: Any]]).count == 12)
assert((checkoutPlan["skipped"] as! [[String: String]]).isEmpty)
var broadKinds = checkoutRules; broadKinds["f4"] = .addressWithoutPrefecture; broadKinds["f10"] = .fullAddress
assert(FillPlanner.contextualAddressKinds(fields: checkout, kinds: broadKinds)["f4"] == .localityStreet)
assert(FillPlanner.contextualAddressKinds(fields: checkout, kinds: broadKinds)["f10"] == .localityStreet)
let singleAddress = [field("住所全体", id: "f0", groupID: "g0"), field("建物名", id: "f1", groupID: "g0")]
let singleKinds: [String: FieldKind] = ["f0": .fullAddress, "f1": .building]
assert(FillPlanner.contextualAddressKinds(fields: singleAddress, kinds: singleKinds)["f0"] == .prefectureMunicipalityLocalityStreet)
let singlePlan = FillPlanner.plan(fields: singleAddress, kinds: singleKinds, sources: [:], modelFailed: false)
assert((singlePlan["items"] as! [[String: Any]]).map { $0["value"] as! String } == ["東京都千代田区千代田1-1", "テストマンション101号室"])
assert(FillPlanner.rule(for: field("", autocomplete: "billing country-name")) == .unknown)
assert(FillPlanner.rule(for: field("", autocomplete: "shipping tel-national")) == .unknown)
let exampleAddress = [field("住所", placeholder: "例：架空区架空町", id: "f0", groupID: "g0"), field("建物名", id: "f1", groupID: "g0")]
assert(FillPlanner.contextualAddressKinds(fields: exampleAddress, kinds: ["f1": .building])["f0"] == nil)
let isolated = [field("住所1", id: "f0", groupID: "g0"), field("建物名", id: "f1", groupID: "g1")]
assert(FillPlanner.contextualAddressKinds(fields: isolated, kinds: ["f1": .building])["f0"] == nil)
let collision = [field("町名・番地", id: "f0", groupID: "g0"), field("番地", id: "f1", groupID: "g0")]
assert(FillPlanner.overlappingAddressGroups(fields: collision, kinds: ["f0": .localityStreet, "f1": .street]).count == 1)
let partialConflict = FillPlanner.plan(fields: [field("姓", id: "f2", groupID: "g0")] + collision,
    kinds: ["f2": .family, "f0": .localityStreet, "f1": .street], sources: [:], modelFailed: false)
assert((partialConflict["items"] as! [[String: Any]]).map { $0["id"] as! String } == ["f2"])
let repeatedName = [field("姓", id: "f0", groupID: "g0"), field("姓", id: "f1", groupID: "g0")]
assert(FillPlanner.overlappingIdentityIDs(fields: repeatedName, kinds: ["f0": .family, "f1": .family]) == ["f0", "f1"])
let splitPostal = [field("郵便番号", length: 3, id: "f0", groupID: "g0"), field("郵便番号", length: 4, id: "f1", groupID: "g0")]
assert(FillPlanner.overlappingIdentityIDs(fields: splitPostal, kinds: ["f0": .postalFirst3, "f1": .postalLast4]).isEmpty)
let otherRegion = [field("都道府県", id: "f0", groupID: "g1")] + numbered.map { f -> FormField in var f = f; f.groupID = "g0"; return f }
assert(FillPlanner.numberedAddressDefaults(fields: otherRegion, kinds: ["f0": .prefecture]).count == 3)
invalid = valid; invalid["fields"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode([field("姓", groupID: "private-section")]))
assert(FillPlanner.decode(invalid) == nil)
print("Native fill planner: all checks passed")

let inlineFields = [field("姓", id: "f0", groupID: "g0"), field("名", id: "f1", groupID: "g0"), field("電話", id: "f2", groupID: "g0")]
let inlineRequest: [String: Any] = ["version": 1, "type": "analyzeInline", "requestID": UUID().uuidString,
    "fields": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(inlineFields))]
let inlineResult = FillPlanner.analyzeInline(inlineRequest)
assert(inlineResult["ok"] as? Bool == true)
assert((inlineResult["items"] as? [[String: Any]])?.map { $0["value"] as! String } == ["山田", "太郎"])
assert((inlineResult["items"] as? [[String: Any]])?.allSatisfy { $0["source"] as? String == "rule" } == true)
assert(FillPlanner.analyzeInline(["version": 1, "type": "analyzeInline"])["error"] as? String == "invalid_request")
print("Rules-only inline plan passed")
