import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import Foundation

// Synthetic data only. The classifier never receives this profile.
struct DummyProfile: ProfileValues {
    let id = "dummy-v1"
    let family = "山田"
    let given = "太郎"
    let familyKana = "ヤマダ"
    let givenKana = "タロウ"
    let postal = "1000001"
    let prefecture = "東京都"
    let municipality = "千代田区"
    let locality = "千代田"
    let street = "1-1"
    let building = "テストマンション101号室"
}
