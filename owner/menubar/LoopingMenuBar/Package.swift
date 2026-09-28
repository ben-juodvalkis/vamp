// swift-tools-version:5.9
import PackageDescription

// Standalone SwiftPM package for the Looping menu-bar utility.
//
// Build & run without Xcode:   swift run
// Open in Xcode:               open Package.swift (or `xed .`)
//
// The Dock icon is suppressed at runtime via NSApp.setActivationPolicy(.accessory)
// (see AppDelegate), so no Info.plist / LSUIElement is required to run it as a
// pure menu-bar agent straight from `swift run`.
let package = Package(
    name: "LoopingMenuBar",
    platforms: [.macOS(.v13)], // MenuBarExtra requires macOS 13+
    targets: [
        .executableTarget(
            name: "LoopingMenuBar",
            path: "Sources/LoopingMenuBar"
        )
    ]
)
