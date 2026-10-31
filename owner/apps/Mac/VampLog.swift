import Darwin
import Foundation

/// Lines Vamp for Mac writes into `logs/vamp-mac.log`, beside its child's
/// output: what it started and stopped, its self-update, and the link to
/// the iPad coming and going. State changes only, never per message.
enum VampLog {
    /// Set once at launch from the repo the app runs.
    nonisolated(unsafe) static var url: URL?

    /// Opened for appending: this app and the child each hold the file, and
    /// without O_APPEND each writes at its own offset, over the other's lines.
    static func open() -> FileHandle? {
        guard let url else { return nil }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let fd = Darwin.open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard fd >= 0 else { return nil }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    static func line(_ text: String) {
        guard let handle = open() else { return }
        handle.write(Data("\n[\(Date())] \(text)\n".utf8))
        try? handle.close()
    }
}
