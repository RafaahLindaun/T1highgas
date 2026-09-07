import SwiftUI

@main
struct HighGASApp: App {
    @StateObject private var vpn = VPNController()

    var body: some Scene {
        WindowGroup {
            ContentView(vpn: vpn)
                .frame(minWidth: 460, minHeight: 560)
                .task {
                    await vpn.bootstrap()
                }
                .onOpenURL { url in
                    Task {
                        await vpn.handle(url: url)
                    }
                }
        }
        .windowResizability(.contentSize)
    }
}

private struct ContentView: View {
    @ObservedObject var vpn: VPNController

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black, Color(red: 0.03, green: 0.08, blue: 0.07)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 28) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 48, height: 48)
                        Image(systemName: "shield.lefthalf.filled")
                            .font(.system(size: 23, weight: .semibold))
                            .foregroundStyle(.green)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("HighGAS")
                            .font(.system(size: 25, weight: .bold, design: .rounded))
                        Text("VPN nativa para macOS")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }

                Spacer(minLength: 8)

                ZStack {
                    Circle()
                        .fill(vpn.isConnected ? Color.green.opacity(0.16) : Color.white.opacity(0.05))
                        .frame(width: 220, height: 220)
                    Circle()
                        .stroke(vpn.isConnected ? Color.green.opacity(0.75) : Color.white.opacity(0.12), lineWidth: 2)
                        .frame(width: 185, height: 185)
                    Image(systemName: vpn.isConnected ? "checkmark.shield.fill" : "power")
                        .font(.system(size: 62, weight: .medium))
                        .foregroundStyle(vpn.isConnected ? .green : .white)
                }

                VStack(spacing: 8) {
                    Text(vpn.stateTitle)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)
                    Text(vpn.stateDetail)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 360)
                }

                HStack(spacing: 10) {
                    Label(vpn.selectedServerCode, systemImage: "network")
                    Text("•")
                        .foregroundStyle(.secondary)
                    Label(statusName(vpn.vpnStatus), systemImage: vpn.isConnected ? "lock.fill" : "lock.open")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if vpn.isConnected {
                    Button {
                        vpn.disconnect()
                    } label: {
                        Label("Desligar VPN", systemImage: "power")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red.opacity(0.85))
                    .disabled(!vpn.canToggle)
                } else {
                    Button {
                        Task {
                            await vpn.connect(serverCode: vpn.selectedServerCode)
                        }
                    } label: {
                        Label(vpn.needsProfile ? "Receber perfil do site" : "Ligar VPN", systemImage: "power")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!vpn.canToggle)
                }

                if vpn.needsProfile {
                    Text("Sem Finder e sem WireGuard separado: volte ao site, importe o perfil uma única vez e toque em Ligar VPN. O site transfere localmente para este app e o HighGAS salva no Keychain.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Spacer(minLength: 8)

                HStack {
                    Text("highgas://")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Esquecer perfil atual") {
                        Task { await vpn.forgetCurrentProfile() }
                    }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(32)
        }
        .preferredColorScheme(.dark)
    }

    private func statusName(_ status: NEVPNStatus) -> String {
        switch status {
        case .invalid: return "pronto"
        case .disconnected: return "desconectado"
        case .connecting: return "conectando"
        case .connected: return "conectado"
        case .reasserting: return "reconectando"
        case .disconnecting: return "desconectando"
        @unknown default: return "desconhecido"
        }
    }
}
