import FormFillCore
import FormFillApplication
import SwiftUI

@main
struct FormFillApp: App {
    private let dependencies = AppDependencies.live

    var body: some Scene {
        WindowGroup { ContentView(dependencies: dependencies) }
    }
}
