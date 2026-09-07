import Foundation
import Security

enum ProfileVaultError: LocalizedError {
    case invalidUTF8
    case keychain(OSStatus)
    case missingPersistentReference
    case invalidStoredValue

    var errorDescription: String? {
        switch self {
        case .invalidUTF8:
            return "O perfil não está em UTF-8 válido."
        case .keychain(let status):
            return "Falha no Keychain (código \(status))."
        case .missingPersistentReference:
            return "O Keychain não retornou a referência segura do perfil."
        case .invalidStoredValue:
            return "O perfil salvo no Keychain está inválido."
        }
    }
}

enum ProfileVault {
    private static func baseQuery(account: String) -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: HighGASConstants.profileService,
            kSecAttrAccount: account,
            kSecAttrSynchronizable: false,
            kSecUseDataProtectionKeychain: true
        ]

        if let group = HighGASConstants.keychainAccessGroup, !group.isEmpty {
            query[kSecAttrAccessGroup] = group
        }

        return query
    }

    static func save(rawConfig: String, account: String) throws -> Data {
        guard let data = rawConfig.data(using: .utf8) else {
            throw ProfileVaultError.invalidUTF8
        }

        SecItemDelete(baseQuery(account: account) as CFDictionary)

        var add = baseQuery(account: account)
        add[kSecAttrLabel] = "HighGAS WireGuard: \(account)"
        add[kSecAttrDescription] = "HighGAS WireGuard profile"
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecValueData] = data
        add[kSecReturnPersistentRef] = true

        var result: CFTypeRef?
        let status = SecItemAdd(add as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw ProfileVaultError.keychain(status)
        }
        guard let reference = result as? Data else {
            throw ProfileVaultError.missingPersistentReference
        }
        return reference
    }

    static func persistentReference(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnPersistentRef] = true
        query[kSecMatchLimit] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw ProfileVaultError.keychain(status)
        }
        return result as? Data
    }

    static func load(persistentReference: Data) throws -> String {
        let query: [CFString: Any] = [
            kSecValuePersistentRef: persistentReference,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
            kSecUseDataProtectionKeychain: true
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw ProfileVaultError.keychain(status)
        }
        guard
            let data = result as? Data,
            let value = String(data: data, encoding: .utf8)
        else {
            throw ProfileVaultError.invalidStoredValue
        }
        return value
    }

    static func remove(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ProfileVaultError.keychain(status)
        }
    }
}
