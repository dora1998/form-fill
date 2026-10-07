import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

final class BridgeContractTests: XCTestCase {
    func testRegression() throws {
        let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../Tests/Contracts/analyze-requests.json").standardizedFileURL.path
        let fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [[String: Any]]
        for fixture in fixtures {
            let valid = BridgeContract.decode(fixture["request"]) != nil
            precondition(valid == fixture["valid"] as! Bool, "contract fixture failed: \(fixture["name"]!)")
        }
        precondition(BridgeContract.decode(["version": 1, "type": "analyzeInline"]) == nil)
        print("Native bridge: \(fixtures.count) shared contract fixtures passed")
    }
}
