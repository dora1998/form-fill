import FormFillCore
import FormFillApplication
import FormFillApple
import Foundation

/// The app is the composition root; feature views receive only application ports.
struct AppDependencies {
    let profiles: ProfileEditingClient
    let reports: ReportRepository

    static var live: Self {
        let files = FileReportRepository()
        return Self(profiles: KeychainProfileRepository.live.editingClient, reports: files.client)
    }

    static var preview: Self {
        Self(profiles: ProfileEditingClient(open: { nil }, save: { profile, _ in profile }, delete: {}),
             reports: ReportRepository(list: { [] }, read: { _ in Data() }, delete: { _ in }))
    }
}
