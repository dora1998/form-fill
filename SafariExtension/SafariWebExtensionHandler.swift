import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: BridgeContract.response(
            to: item?.userInfo?[SFExtensionMessageKey]
        )]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
