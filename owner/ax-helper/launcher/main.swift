// Looping AX Helper launcher (ADR-439).
//
// This binary is the identity macOS Accessibility trusts. launchd starts it
// from the LaunchAgent, which makes it its own *responsible process*; the
// Python helper it spawns inherits that responsibility, so the one grant given
// to "Looping AX Helper" in System Settings covers the helper no matter which
// terminal started `npm run dev`.
//
// Two rules keep that true:
//   - spawn a child, never exec: TCC checks the responsible process's code
//     signature, and exec would swap this signed binary for uv;
//   - read the command from Info.plist, which the code signature seals, never
//     from argv, so the trusted identity cannot be pointed at another program.
import Foundation

let info = Bundle.main.infoDictionary ?? [:]
guard let uv = info["LoopingUvPath"] as? String,
      let project = info["LoopingHelperProject"] as? String else {
    FileHandle.standardError.write(
        "Looping AX Helper: Info.plist lacks LoopingUvPath / LoopingHelperProject; reinstall with `npm run install-ax-helper`\n"
            .data(using: .utf8)!)
    exit(78) // EX_CONFIG
}

let child = Process()
child.executableURL = URL(fileURLWithPath: uv)
child.arguments = ["run", "--frozen", "--no-dev", "--project", project, "python", "-m", "looping_ax_helper"]
child.currentDirectoryURL = URL(fileURLWithPath: project)
var environment = ProcessInfo.processInfo.environment
environment["LOOPING_AX_HELPER_BUNDLE"] = Bundle.main.bundlePath
environment["PYTHONUNBUFFERED"] = "1"
child.environment = environment

// Forward stop signals to the child, then exit with its status when it goes.
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT, SIGHUP] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        if child.isRunning { kill(child.processIdentifier, sig) }
    }
    source.resume()
    signalSources.append(source)
}
child.terminationHandler = { process in exit(process.terminationStatus) }

do {
    try child.run()
} catch {
    FileHandle.standardError.write("Looping AX Helper: cannot start \(uv): \(error)\n".data(using: .utf8)!)
    exit(71) // EX_OSERR
}
dispatchMain()
