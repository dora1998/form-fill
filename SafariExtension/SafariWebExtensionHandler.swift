import FormFillCore
import FormFillApplication
import FormFillApple
import FormFillBridge
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let fills = ProfileFillService(authorize: { LocalProfileAuthorization(reason: $0) })
    private static let reports = FileReportRepository()
    private static let saveReport = SaveDeveloperReportService(
        loadProfile: { try await KeychainProfileRepository.live.openForEditing() },
        persist: { try await reports.save($0) })
    private static let router = NativeMessageRouter(
        classifier: ClassificationService(model: FoundationModelsClient.classification),
        fills: fills,
        saveReport: { try await saveReport.run($0) },
        probeModel: FoundationModelsClient.probe)

    func beginRequest(with context: NSExtensionContext) {
        let message = (context.inputItems.first as? NSExtensionItem)?.userInfo?[SFExtensionMessageKey]
        Task {
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: await Self.router.handle(message)]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}
