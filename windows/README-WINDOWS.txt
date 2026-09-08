HighGAS Windows x64 - Full Tunnel

INSTALAR
1. Extraia o ZIP inteiro.
2. Abra o Windows Terminal ou PowerShell como Administrador na pasta extraida.
3. Execute: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
4. Ao final, abra https://127.0.0.1:37654/.

FUNCIONAMENTO
- TCP IPv4: roteado pelo Tor para o pais selecionado.
- DNS: interceptado pelo TUN e resolvido pelo DNSPort do Tor.
- IPv6: bloqueado durante a conexao para impedir vazamento.
- UDP: bloqueado durante a conexao; apps normalmente recuam para TCP.
- O processo tor.exe sai pela interface fisica para evitar loop de tunel.

SERVIDORES
- de-fra-01: Alemanha (saida Tor DE)
- us-mia-01: Estados Unidos (saida Tor US)

DESINSTALAR
Abra PowerShell como Administrador e execute:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1

LIMITES
A rede Tor escolhe um relay de saida do pais solicitado; isso nao garante cidade ou IP fixo.
Nenhum VPN pode garantir que uma plataforma de terceiros aceite ou classifique uma conta em determinada regiao.
