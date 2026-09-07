# HighGAS Native for macOS

Este diretório contém o primeiro companion nativo do HighGAS. O objetivo é remover o fluxo `site -> Finder -> WireGuard` e substituir por:

`lowgas.vercel.app -> highgas://connect -> HighGAS.app -> Network Extension -> WireGuardKit`

## O que esta versão já resolve

- registra o protocolo exclusivo `highgas://` no macOS;
- o botão **Ligar VPN** do site tenta abrir o app HighGAS antes do fluxo legado;
- o app usa `NETunnelProviderManager` para instalar/gerenciar a configuração VPN do próprio HighGAS;
- o túnel roda em uma `NEPacketTunnelProvider` embutida no HighGAS;
- não precisa instalar o aplicativo WireGuard oficial para executar o túnel;
- perfis WireGuard ficam no Keychain compartilhado entre app e extensão;
- o site não envia a chave privada para Neon;
- na primeira transferência, o site coloca um payload temporário no clipboard, o app consome, limpa o clipboard e salva no Keychain;
- depois que um servidor já tem perfil no Keychain, `highgas://connect?server=br-sao-01` pode conectar sem Finder e sem nova importação.

## Limite atual importante

Os cinco registros atuais do catálogo HighGAS são metadados (país, cidade, status). O backend ainda não provisiona peers WireGuard reais automaticamente. Portanto, para cada servidor real, ainda é necessário existir um perfil WireGuard válido pelo menos uma vez.

A fase seguinte para **zero Finder desde o primeiro uso** é um endpoint de provisionamento que:

1. gera a chave privada localmente no app;
2. envia somente a chave pública para o control-plane HighGAS;
3. registra o peer no servidor WireGuard correspondente;
4. devolve endpoint, chave pública do servidor, IP interno, DNS e AllowedIPs;
5. monta o túnel diretamente no app, sem `.conf`.

Não implementar esse endpoint com dados fictícios: ele depende dos servidores WireGuard reais estarem disponíveis.

## Requisitos de build

- macOS 13 ou superior;
- Xcode atual;
- Apple Developer Team com a capability **Network Extensions** habilitada;
- Homebrew;
- `xcodegen`;
- Go (necessário para o bridge userspace do WireGuardKit).

Instalação das ferramentas:

```bash
brew install xcodegen go
```

Gerar o projeto:

```bash
cd native/macos
zsh bootstrap.sh
open HighGAS.xcodeproj
```

No Xcode:

1. selecione o mesmo Apple Developer Team nos targets `HighGAS` e `HighGASTunnel`;
2. confirme os bundle IDs `app.highgas.macos` e `app.highgas.macos.tunnel`;
3. confirme a capability Network Extensions / Packet Tunnel Provider;
4. execute o target `HighGAS`.

Na primeira instalação o macOS pode pedir autorização para adicionar uma configuração VPN. Essa autorização é do sistema e não pode ser removida por código. Depois da configuração inicial, o app pode iniciar/parar o túnel programaticamente.

## WireGuardKit

O projeto usa o pacote `WireGuard/wireguard-apple` e seu produto `WireGuardKit`. O `project.yml` inclui uma fase que compila automaticamente o bridge Go exigido pelo WireGuardKit, evitando a criação manual do target externo descrito no projeto upstream.

## Segurança do perfil

O perfil completo não é salvo em banco. O caminho temporário é:

`browser memory -> clipboard -> HighGAS.app -> Keychain`

O app limpa o clipboard assim que consegue decodificar o payload. Depois disso, somente uma persistent reference do Keychain é armazenada no `NETunnelProviderProtocol`.

## URL scheme

Exemplos:

```text
highgas://connect?server=br-sao-01
highgas://connect?server=us-mia-01
highgas://disconnect
highgas://toggle?server=br-sao-01
```

O site usa o primeiro formato.
