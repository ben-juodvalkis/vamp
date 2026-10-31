import Foundation

/// The iPads this Mac has paired with (ADR-494): each Vamp for iPad's link
/// key, by its id, and the iPad's serial number when it came over the cable.
/// Kept in `~/Library/Application Support/Vamp/paired-ipads.json`, readable
/// by this account only. Read and written on the link's queue only, which
/// is what makes it safe to hand to closures that run there (hence
/// `@unchecked Sendable`).
///
/// An iPad whose serial is here has spoken the authenticated link, so the
/// unauthenticated one (version 1, for a Vamp for iPad installed before it)
/// is refused for it: another app on that iPad cannot downgrade the link.
final class PairedIPads: @unchecked Sendable {
    struct Entry: Codable, Equatable {
        var key: String
        var serial: String?
        var added: Date
    }

    private let file: URL
    private var entries: [String: Entry]

    init(file: URL = PairedIPads.defaultFile) {
        self.file = file
        entries = (try? JSONDecoder().decode([String: Entry].self, from: Data(contentsOf: file))) ?? [:]
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Vamp/paired-ipads.json")
    }

    func key(for id: String) -> LinkKey? {
        entries[id].flatMap { LinkKey(hex: $0.key) }
    }

    func knows(serial: String) -> Bool {
        entries.values.contains { $0.serial == serial }
    }

    var isEmpty: Bool { entries.isEmpty }

    func add(_ key: LinkKey, serial: String?) {
        entries[key.id] = Entry(key: key.hex, serial: serial, added: Date())
        save()
    }

    func forgetAll() {
        entries.removeAll()
        save()
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(entries)
            FileManager.default.createFile(atPath: file.path, contents: data, attributes: [.posixPermissions: 0o600])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch {
            VampLog.line("iPad link: could not save the paired iPads (\(error.localizedDescription))")
        }
    }
}
