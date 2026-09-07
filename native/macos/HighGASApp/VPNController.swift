import AppKit
import Foundation
import NetworkExtension

@MainActor
final class VPNController: ObservableObject {
    @Published private(set) var vpnStatus: NEVPNStatus = .invalid
    @Published private(set) var stateTitle = "Preparando HighGAS"
    @Published private(set) var stateDetail = "Carregando a configuração VPN do macOS…"
    @Published private(set) var selectedServerCode = "br-sao-01"
    @Published private(set) var needsProfile = false
    @Published private(set) var isWorking = false

    private var manager: NETunnelProviderManager?
    private var statusObserver: NSObjectProtocol?
    private var didBootstrap = false

    var isConnected: Bool { vpnStatus == .connected }
    var canToggle: Bool { !isWorking && vpnStatus != .connecting && vpnStatus != .disconnecting }

    deinit {
        if let statusObserver {
            NotificationCenter.default.removeObserver(statusObserver)
        }
    }

    func bootstrap() async {
        guard !didBootstrap else { return }
        didBootstrap = true

        do {
            manager = try await loadHighGASManager()
            observeStatus()
            refreshStatusCopy()
            updatePresentation()
        } catch {
            present(error)
        }
    }

    func handle(url: URL) async {
        guard url.scheme?.lowercased() == "highgas" else { return }
        await bootstrap()

        let action = (url.host ?? "").lowercased()
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let server = components?.queryItems?.first(where: { $0.name == "server" })?.value

        switch action {
        case "connect":
            await connect(serverCode: server ?? selectedServerCode)
        case "disconnect":
            disconnect()
        case "toggle":
            if isConnected { disconnect() } else { await connect(serverCode: server ?? selectedServerCode) }
        default:
            stateTitle = "Comando HighGAS inválido"
            stateDetail = "O link recebido não contém uma ação reconhecida."
        }
    }

    func connect(serverCode: String) async {
        await bootstrap()
        selectedServerCode = serverCode
        needsProfile = false
        isWorking = true
        stateTitle = "Conectando"
        stateDetail = "Preparando \(serverCode)…"
        defer { isWorking = false }

        do {
            let reference: Data
            if let saved = try ProfileVault.persistentReference(account: serverCode) {
                reference = saved
            } else if let handedOffProfile = ClipboardProfileHandoff.consume() {
                try ProfileSanityCheck.validate(handedOffProfile)
                reference = try ProfileVault.save(rawConfig: handedOffProfile, account: serverCode)
            } else {
                needsProfile = true
                stateTitle = "Configuração inicial"
                stateDetail = "O HighGAS ainda não recebeu o perfil deste servidor. Abra o site, importe o .conf uma única vez e toque em Ligar VPN novamente. Depois ele fica no Keychain."
                return
            }

            try await configureManager(profileReference: reference, serverCode: serverCode)
            try startTunnel()
            updatePresentation()
        } catch {
            present(error)
        }
    }

    func disconnect() {
        guard let manager else { return }
        needsProfile = false
        stateTitle = "Desconectando"
        stateDetail = "Encerrando o túnel HighGAS…"
        manager.connection.stopVPNTunnel()
    }

    func forgetCurrentProfile() async {
        do {
            disconnect()
            try ProfileVault.remove(account: selectedServerCode)
            needsProfile = true
            stateTitle = "Perfil removido"
            stateDetail = "O perfil deste servidor foi removido do Keychain."

            guard let manager else { return }
            manager.protocolConfiguration = nil
            manager.isEnabled = false
            try await save(manager)
        } catch {
            present(error)
        }
    }

    private func configureManager(profileReference: Data, serverCode: String) async throws {
        let manager = self.manager ?? NETunnelProviderManager()
        let raw = try ProfileVault.load(persistentReference: profileReference)

        let tunnelProtocol = NETunnelProviderProtocol()
        tunnelProtocol.providerBundleIdentifier = HighGASConstants.providerBundleIdentifier
        tunnelProtocol.serverAddress = ProfileSanityCheck.firstEndpoint(in: raw) ?? serverCode
        tunnelProtocol.passwordReference = profileReference
        tunnelProtocol.providerConfiguration = [
            "serverCode": serverCode,
            "profileVersion": 1
        ]

        manager.localizedDescription = HighGASConstants.tunnelDisplayName
        manager.protocolConfiguration = tunnelProtocol
        manager.isEnabled = true

        try await save(manager)
        try await reload(manager)
        self.manager = manager
        observeStatus()
        refreshStatusCopy()
    }

    private func startTunnel() throws {
        guard let manager else { throw HighGASAppError.managerUnavailable }

        switch manager.connection.status {
        case .connected, .connecting, .reasserting:
            return
        default:
            try manager.connection.startVPNTunnel()
        }
    }

    private func loadHighGASManager() async throws -> NETunnelProviderManager {
        let managers: [NETunnelProviderManager] = try await withCheckedThrowingContinuation { continuation in
            NETunnelProviderManager.loadAllFromPreferences { managers, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: managers ?? [])
                }
            }
        }

        if let existing = managers.first(where: { manager in
            if manager.localizedDescription == HighGASConstants.tunnelDisplayName { return true }
            guard let tunnel = manager.protocolConfiguration as? NETunnelProviderProtocol else { return false }
            return tunnel.providerBundleIdentifier == HighGASConstants.providerBundleIdentifier
        }) {
            return existing
        }

        return NETunnelProviderManager()
    }

    private func save(_ manager: NETunnelProviderManager) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            manager.saveToPreferences { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    private func reload(_ manager: NETunnelProviderManager) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            manager.loadFromPreferences { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    private func observeStatus() {
        if let statusObserver {
            NotificationCenter.default.removeObserver(statusObserver)
        }

        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: manager?.connection,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshStatusCopy()
                self?.updatePresentation()
            }
        }
    }

    private func refreshStatusCopy() {
        vpnStatus = manager?.connection.status ?? .invalid
    }

    private func updatePresentation() {
        if needsProfile { return }

        switch vpnStatus {
        case .invalid:
            stateTitle = "HighGAS pronto"
            stateDetail = "Escolha um país no site e toque em Ligar VPN."
        case .disconnected:
            stateTitle = "Não conectado"
            stateDetail = "O HighGAS está instalado e pronto para um toque."
        case .connecting:
            stateTitle = "Conectando"
            stateDetail = "O macOS está ativando o túnel HighGAS."
        case .connected:
            stateTitle = "Você está conectado"
            stateDetail = "VPN HighGAS ativa · \(selectedServerCode)"
        case .reasserting:
            stateTitle = "Reconectando"
            stateDetail = "O HighGAS está restabelecendo o túnel."
        case .disconnecting:
            stateTitle = "Desconectando"
            stateDetail = "Encerrando a conexão segura."
        @unknown default:
            stateTitle = "Status desconhecido"
            stateDetail = "O macOS retornou um estado de VPN ainda não tratado."
        }
    }

    private func present(_ error: Error) {
        needsProfile = false
        stateTitle = "Não foi possível conectar"
        stateDetail = error.localizedDescription
    }
}

enum ClipboardProfileHandoff {
    static func consume() -> String? {
        let pasteboard = NSPasteboard.general
        guard
            let value = pasteboard.string(forType: .string),
            value.hasPrefix(HighGASConstants.clipboardPrefix)
        else {
            return nil
        }

        let encoded = String(value.dropFirst(HighGASConstants.clipboardPrefix.count))
        guard
            let data = Data(base64Encoded: encoded),
            let raw = String(data: data, encoding: .utf8)
        else {
            return nil
        }

        pasteboard.clearContents()
        return raw
    }
}

enum ProfileSanityCheck {
    static func validate(_ raw: String) throws {
        let lowercase = raw.lowercased()
        guard lowercase.contains("[interface]") else { throw HighGASAppError.invalidProfile }
        guard lowercase.contains("privatekey") else { throw HighGASAppError.invalidProfile }
        guard lowercase.contains("[peer]") else { throw HighGASAppError.invalidProfile }
        guard lowercase.contains("publickey") else { throw HighGASAppError.invalidProfile }
    }

    static func firstEndpoint(in raw: String) -> String? {
        for rawLine in raw.components(separatedBy: .newlines) {
            let line = rawLine.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let separator = trimmed.firstIndex(of: "=") else { continue }
            let key = trimmed[..<separator].trimmingCharacters(in: .whitespacesAndNewlines)
            if key.caseInsensitiveCompare("Endpoint") == .orderedSame {
                return trimmed[trimmed.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }
}

enum HighGASAppError: LocalizedError {
    case managerUnavailable
    case invalidProfile

    var errorDescription: String? {
        switch self {
        case .managerUnavailable:
            return "O gerenciador de VPN do HighGAS ainda não está disponível."
        case .invalidProfile:
            return "O conteúdo recebido não parece um perfil WireGuard válido."
        }
    }
}
