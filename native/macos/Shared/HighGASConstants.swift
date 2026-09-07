import Foundation

enum HighGASConstants {
    static let tunnelDisplayName = "HighGAS"
    static let providerBundleIdentifier = "app.highgas.macos.tunnel"
    static let profileService = "app.highgas.profile"
    static let clipboardPrefix = "HIGHGAS-WG-V1:"

    static var keychainAccessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "HighGASKeychainAccessGroup") as? String
    }
}
