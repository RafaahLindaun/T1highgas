import Foundation
import NetworkExtension
import os
import WireGuardKit

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let logger = Logger(subsystem: "app.highgas.macos", category: "tunnel")

    private lazy var adapter = WireGuardAdapter(with: self) { [weak self] level, message in
        guard let self else { return }
        switch level {
        case .error:
            self.logger.error("\(message, privacy: .public)")
        case .verbose:
            self.logger.debug("\(message, privacy: .public)")
        }
    }

    override func startTunnel(
        options: [String: NSObject]?,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard
            let tunnelProtocol = protocolConfiguration as? NETunnelProviderProtocol,
            let reference = tunnelProtocol.passwordReference
        else {
            completionHandler(HighGASTunnelError.missingProfileReference)
            return
        }

        do {
            let rawConfig = try ProfileVault.load(persistentReference: reference)
            let serverCode = tunnelProtocol.providerConfiguration?["serverCode"] as? String ?? "highgas"
            let configuration = try WgQuickParser.parse(rawConfig, name: serverCode)

            adapter.start(tunnelConfiguration: configuration) { [weak self] error in
                if let error {
                    self?.logger.error("Falha ao iniciar WireGuard: \(error.localizedDescription, privacy: .public)")
                    completionHandler(error)
                } else {
                    self?.logger.info("Túnel HighGAS iniciado")
                    completionHandler(nil)
                }
            }
        } catch {
            logger.error("Perfil HighGAS inválido: \(error.localizedDescription, privacy: .public)")
            completionHandler(error)
        }
    }

    override func stopTunnel(
        with reason: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        logger.info("Parando túnel HighGAS")
        adapter.stop { [weak self] error in
            if let error {
                self?.logger.error("Erro ao parar WireGuard: \(error.localizedDescription, privacy: .public)")
            }
            completionHandler()
        }
    }

    override func handleAppMessage(
        _ messageData: Data,
        completionHandler: ((Data?) -> Void)? = nil
    ) {
        guard let completionHandler else { return }

        // 0x00 asks WireGuardKit for the runtime configuration. This lets the
        // HighGAS app add handshake/traffic diagnostics later without exposing
        // the private profile itself.
        if messageData == Data([0]) {
            adapter.getRuntimeConfiguration { settings in
                completionHandler(settings?.data(using: .utf8))
            }
        } else {
            completionHandler(nil)
        }
    }
}

enum HighGASTunnelError: LocalizedError {
    case missingProfileReference

    var errorDescription: String? {
        switch self {
        case .missingProfileReference:
            return "A configuração segura do HighGAS não foi encontrada."
        }
    }
}
