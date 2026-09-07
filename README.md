# HighGAS

HighGAS é um painel pessoal para macOS com controle local, sem login, sem Xcode e sem assinatura obrigatória.

## Modo gratuito atual

- Alemanha e Estados Unidos usam a rede Tor por meio do Tor Expert Bundle oficial;
- o usuário escolhe o país e usa o mesmo botão LIGAR/DESLIGAR;
- não exige cartão, conta em nuvem nem arquivo WireGuard `.conf` para essas duas saídas;
- o helper fica apenas em `127.0.0.1` e a interface local usa HTTPS;
- o HighGAS consulta o IP de saída para mostrar no painel o país detectado;
- ao desligar, o helper restaura as configurações de proxy/DNS que encontrou antes de ligar.

### Limite importante do modo Tor

O modo gratuito configura um proxy SOCKS do macOS e DNS local através do Tor. Navegadores e aplicativos que respeitam o proxy do sistema passam pelo Tor. Tráfego UDP e aplicativos que ignoram o proxy do macOS podem continuar usando a conexão normal. Portanto, esse modo não deve ser descrito como um túnel VPN WireGuard completo.

Alguns sites também podem identificar ou bloquear IPs públicos da rede Tor, e a velocidade costuma ser menor que a de um servidor WireGuard dedicado.

## WireGuard próprio

O motor `wireguard-go` continua incluído no HighGAS para uso futuro com servidores próprios. Perfis `.conf` ficam somente no Mac, em diretório protegido, e chaves privadas não são enviadas para GitHub, Vercel ou banco de dados.

## Arquitetura

- React + Vite no frontend;
- helper Go local no macOS;
- interface local em `https://127.0.0.1:37654`;
- Tor Expert Bundle oficial como transporte gratuito opcional;
- `wireguard-go` para túneis próprios quando existirem endpoints WireGuard reais.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
