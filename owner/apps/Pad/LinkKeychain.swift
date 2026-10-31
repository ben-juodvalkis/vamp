import Foundation
import Security

/// Vamp for iPad's link key (ADR-494), made once and kept in this app's
/// Keychain, which no other app can read. It survives reinstalls of the app
/// from Xcode; deleting the app forgets it, and the iPad pairs again.
enum LinkKeychain {
    private static let service = "com.benjuodvalkis.vamp.link"
    private static let account = "key"

    static func loadOrCreate() -> LinkKey {
        if let key = load() { return key }
        let key = LinkKey.random()
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: key.raw,
            // Readable after the first unlock: the link starts with the app,
            // which may be before the iPad is unlocked again.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        SecItemAdd(item as CFDictionary, nil)
        return key
    }

    private static func load() -> LinkKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, data.count == 32 else { return nil }
        return LinkKey(raw: data)
    }
}
