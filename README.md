# HighGAS

HighGAS é um painel pessoal para macOS com controle local, sem login, sem Xcode e sem assinatura obrigatória.

**Versão atual:** HighGAS 1.0 — Full Tunnel para macOS Intel, com saídas Alemanha/EUA via Tor.

## HighGAS 1.0

- Alemanha e Estados Unidos usam o Tor Expert Bundle oficial;
- o usuário escolhe o país e usa o mesmo botão LIGAR VPN / DESLIGAR VPN;
- não exige cartão, conta em nuvem nem arquivo WireGuard `.conf` para essas duas saídas;
- o helper fica apenas em `127.0.0.1` e a interface local usa HTTPS;
- o tráfego TCP IPv4 é encaminhado pelo `utun` através do `tun2socks` e do Tor;
- o DNS é apontado para o resolver local do Tor;
- IPv6 e UDP são bloqueados enquanto o túnel está ativo para evitar vazamento fora do caminho protegido;
- um Kill Switch baseado em PF bloqueia tráfego direto que não pertença ao mecanismo do HighGAS;
- o HighGAS verifica IP alterado, país esperado, DNS, IPv6 e rotas antes de considerar a conexão protegida;
- se a verificação completa falhar, a conexão é encerrada em modo fail-closed;
- ao desligar, o HighGAS remove rotas, restaura DNS e desativa as regras temporárias que criou.

### O que “Full Tunnel” significa nesta versão

O Full Tunnel atual cobre **TCP IPv4 + DNS**. IPv6 e UDP não são encaminhados pelo Tor: ficam bloqueados enquanto a proteção está ligada. Isso evita que aplicações contornem o túnel por esses protocolos.

Alguns serviços podem identificar ou bloquear IPs públicos da rede Tor, e a velocidade costuma ser menor que a de um servidor dedicado. Além do endereço IP, plataformas podem usar outros sinais próprios de conta, dispositivo, documentação, residência, empresa, estoque ou comportamento. O HighGAS é uma ferramenta de rede e não substitui requisitos de elegibilidade, KYC ou regras de uma plataforma.

## Verificação da versão final

O pacote final para macOS Intel possui automação de validação que cobre, entre outros pontos:

- build do frontend;
- `go vet` e testes do helper;
- validação sintática dos scripts macOS;
- arquitetura Intel dos binários empacotados;
- integridade SHA-256;
- instalação real do helper no runner macOS Intel;
- health check local;
- catálogo Alemanha/EUA;
- conexão e desconexão em ambos os países;
- confirmação do país de saída;
- DNS protegido;
- IPv6 sem vazamento;
- verificação das rotas do Full Tunnel;
- desinstalação e restauração do ambiente.

## Arquitetura

- React + Vite no frontend;
- helper Go local no macOS;
- interface local em `https://127.0.0.1:37654`;
- Tor Expert Bundle oficial como transporte;
- `tun2socks` para o `utun` Full Tunnel TCP IPv4;
- PF para Kill Switch;
- `wireguard-go` permanece incluído para endpoints WireGuard próprios futuros.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
