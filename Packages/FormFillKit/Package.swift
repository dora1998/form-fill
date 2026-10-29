// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FormFillKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "FormFillCore", targets: ["FormFillCore"]),
        .library(name: "FormFillApplication", targets: ["FormFillApplication"]),
        .library(name: "FormFillApple", targets: ["FormFillApple"]),
        .library(name: "FormFillBridge", targets: ["FormFillBridge"]),
        .executable(name: "AddressAccuracy", targets: ["AddressAccuracy"])
    ],
    targets: [
        .target(name: "FormFillCore"),
        .target(name: "FormFillApplication", dependencies: ["FormFillCore"]),
        .target(name: "FormFillApple", dependencies: ["FormFillCore", "FormFillApplication"]),
        .target(name: "FormFillBridge", dependencies: ["FormFillCore", "FormFillApplication"]),
        .testTarget(name: "FormFillKitTests", dependencies: [
            "FormFillCore", "FormFillApplication", "FormFillApple", "FormFillBridge"
        ]),
        .executableTarget(name: "AddressAccuracy", dependencies: [
            "FormFillCore", "FormFillApplication", "FormFillApple", "FormFillBridge"
        ], path: "Evaluation/AddressAccuracy")
    ],
    swiftLanguageModes: [.v5]
)
