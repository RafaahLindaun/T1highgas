import Foundation
import WireGuardKit

enum WgQuickParserError: LocalizedError {
    case missingInterface
    case missingPrivateKey
    case invalidPrivateKey
    case invalidAddress(String)
    case invalidDNS(String)
    case invalidListenPort
    case invalidMTU
    case missingPeer
    case missingPeerPublicKey
    case invalidPeerPublicKey
    case invalidPreSharedKey
    case invalidAllowedIP(String)
    case invalidEndpoint(String)
    case invalidKeepAlive

    var errorDescription: String? {
        switch self {
        case .missingInterface: return "Perfil sem [Interface]."
        case .missingPrivateKey: return "Perfil sem PrivateKey."
        case .invalidPrivateKey: return "PrivateKey inválida."
        case .invalidAddress(let value): return "Address inválido: \(value)"
        case .invalidDNS(let value): return "DNS inválido: \(value)"
        case .invalidListenPort: return "ListenPort inválido."
        case .invalidMTU: return "MTU inválido."
        case .missingPeer: return "Perfil sem [Peer]."
        case .missingPeerPublicKey: return "Peer sem PublicKey."
        case .invalidPeerPublicKey: return "PublicKey do peer inválida."
        case .invalidPreSharedKey: return "PresharedKey inválida."
        case .invalidAllowedIP(let value): return "AllowedIPs inválido: \(value)"
        case .invalidEndpoint(let value): return "Endpoint inválido: \(value)"
        case .invalidKeepAlive: return "PersistentKeepalive inválido."
        }
    }
}

struct WgQuickParser {
    private enum Section {
        case interface
        case peer
    }

    static func parse(_ raw: String, name: String) throws -> TunnelConfiguration {
        var currentSection: Section?
        var interfaceValues: [String: String] = [:]
        var peerValues: [[String: String]] = []
        var currentPeer: [String: String] = [:]

        func appendValue(_ value: String, key: String, to dictionary: inout [String: String]) {
            if let existing = dictionary[key], !existing.isEmpty {
                dictionary[key] = existing + "," + value
            } else {
                dictionary[key] = value
            }
        }

        func flushPeer() {
            guard !currentPeer.isEmpty else { return }
            peerValues.append(currentPeer)
            currentPeer.removeAll(keepingCapacity: true)
        }

        for rawLine in raw.components(separatedBy: .newlines) {
            let withoutComment = rawLine.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let line = withoutComment.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }

            if line.caseInsensitiveCompare("[Interface]") == .orderedSame {
                flushPeer()
                currentSection = .interface
                continue
            }

            if line.caseInsensitiveCompare("[Peer]") == .orderedSame {
                flushPeer()
                currentSection = .peer
                continue
            }

            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator])
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            let value = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, !value.isEmpty else { continue }

            switch currentSection {
            case .interface:
                appendValue(value, key: key, to: &interfaceValues)
            case .peer:
                appendValue(value, key: key, to: &currentPeer)
            case .none:
                continue
            }
        }
        flushPeer()

        guard !interfaceValues.isEmpty else { throw WgQuickParserError.missingInterface }
        guard let privateKeyText = interfaceValues["privatekey"] else { throw WgQuickParserError.missingPrivateKey }
        guard let privateKey = PrivateKey(base64Key: privateKeyText) else { throw WgQuickParserError.invalidPrivateKey }

        var interface = InterfaceConfiguration(privateKey: privateKey)

        if let addresses = interfaceValues["address"] {
            interface.addresses = try csv(addresses).map { value in
                guard let range = IPAddressRange(from: value) else { throw WgQuickParserError.invalidAddress(value) }
                return range
            }
        }

        if let dns = interfaceValues["dns"] {
            for value in csv(dns) {
                if let server = DNSServer(from: value) {
                    interface.dns.append(server)
                } else if value.contains(".") {
                    interface.dnsSearch.append(value)
                } else {
                    throw WgQuickParserError.invalidDNS(value)
                }
            }
        }

        if let listenPort = interfaceValues["listenport"] {
            guard let value = UInt16(listenPort) else { throw WgQuickParserError.invalidListenPort }
            interface.listenPort = value
        }

        if let mtu = interfaceValues["mtu"] {
            guard let value = UInt16(mtu) else { throw WgQuickParserError.invalidMTU }
            interface.mtu = value
        }

        guard !peerValues.isEmpty else { throw WgQuickParserError.missingPeer }
        let peers = try peerValues.map { values -> PeerConfiguration in
            guard let publicKeyText = values["publickey"] else { throw WgQuickParserError.missingPeerPublicKey }
            guard let publicKey = PublicKey(base64Key: publicKeyText) else { throw WgQuickParserError.invalidPeerPublicKey }

            var peer = PeerConfiguration(publicKey: publicKey)

            if let preShared = values["presharedkey"] {
                guard let key = PreSharedKey(base64Key: preShared) else { throw WgQuickParserError.invalidPreSharedKey }
                peer.preSharedKey = key
            }

            if let allowed = values["allowedips"] {
                peer.allowedIPs = try csv(allowed).map { value in
                    guard let range = IPAddressRange(from: value) else { throw WgQuickParserError.invalidAllowedIP(value) }
                    return range
                }
            }

            if let endpoint = values["endpoint"] {
                guard let parsed = Endpoint(from: endpoint) else { throw WgQuickParserError.invalidEndpoint(endpoint) }
                peer.endpoint = parsed
            }

            if let keepAlive = values["persistentkeepalive"] {
                guard let value = UInt16(keepAlive) else { throw WgQuickParserError.invalidKeepAlive }
                peer.persistentKeepAlive = value
            }

            return peer
        }

        return TunnelConfiguration(name: name, interface: interface, peers: peers)
    }

    private static func csv(_ value: String) -> [String] {
        value
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
