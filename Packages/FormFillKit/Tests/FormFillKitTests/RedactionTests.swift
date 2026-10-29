import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import Foundation
final class RedactionTests: XCTestCase {
    func testRegression() throws {
        var profile = Profile()
        profile.family = "検証姓"; profile.given = "検証名"
        profile.familyKana = "ケンショウ"; profile.givenKana = "ナマエ"
        profile.postal = "1234567"; profile.prefecture = "東京都"
        profile.municipality = "架空市"; profile.locality = "例町"; profile.street = "12-34"; profile.building = "試験棟101"
        let raw: [String: Any] = ["schemaVersion": 1, "product": "Form Fill developer diagnostics",
            "currentPageURL": "https://example.test/form", "page": ["html": "<label>氏名<input value=\"検証姓 検証名\"></label>",
            "controls": [["value": "東京都架空市例町12-34試験棟101"], ["value": "123-4567"], ["value": "けんしょう"], ["value": "１２－３４"]]],
            "trace": ["prompt": "label 郵便番号", "response": "{\"value\":\"検証名\"}", "encoded": "%E6%A4%9C%E8%A8%BC%E5%90%8D"],
            "other": "他のページ情報と未登録メール sample@example.test", "events": ["input", "change"]]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: raw), as: UTF8.self)
        let report = try DeveloperReportRedactor.redact(json, profile: profile)
        let masked = report.json
        for secret in ["検証姓", "検証名", "東京都", "架空市", "例町", "12-34", "試験棟101", "123-4567", "けんしょう", "１２－３４", "%E6%A4%9C%E8%A8%BC%E5%90%8D"] {
            precondition(!masked.contains(secret), secret)
        }
        for retained in ["<label>", "input", "change", "label 郵便番号", "sample@example.test"] { precondition(masked.contains(retained), retained) }
        let result = try JSONSerialization.jsonObject(with: Data(masked.utf8)) as! [String: Any]
        precondition(result["schemaVersion"] as? Int == 1)
        let unregistered = try DeveloperReportRedactor.redact(json, profile: nil).json
        precondition(unregistered.contains("検証姓"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let saved = try DebugReportStore(directory: directory).save(report)
        let savedText = try String(contentsOf: saved, encoding: .utf8)
        precondition(savedText == masked)
        print("Developer redaction: nested DOM, model JSON, profile variants, preserved structure and masked persistence passed")
    }
}
