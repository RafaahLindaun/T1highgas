HighGAS Final - Windows x64 - Full Tunnel

INSTALAR
1. Extraia o ZIP inteiro.
2. Dê dois cliques em INSTALAR-HIGHGAS-WINDOWS.cmd.
3. Confirme a permissao de Administrador quando o Windows solicitar.
4. O instalador valida o helper, cria o atalho HighGAS na Area de Trabalho e abre a interface local.

ABRIR DEPOIS
Use o atalho HighGAS da Area de Trabalho ou abra:
https://127.0.0.1:37654/

FUNCIONAMENTO
- TCP IPv4: roteado pelo Tor para o pais selecionado.
- DNS: interceptado pelo TUN e resolvido pelo DNSPort do Tor.
- IPv6: bloqueado durante a conexao para impedir vazamento.
- UDP: bloqueado durante a conexao; aplicativos compativeis recuam para TCP.
- tor.exe sai pela interface fisica para evitar loop do proprio tunel.
- O HighGAS so confirma conexao depois de validar IP, pais, TUN, Tor, sing-box e bloqueio de IPv6.

SERVIDORES
- de-fra-01: Alemanha (saida Tor no pais DE)
- us-mia-01: Estados Unidos (saida Tor no pais US)

DESINSTALAR
Dê dois cliques em DESINSTALAR-HIGHGAS-WINDOWS.cmd e confirme a permissao de Administrador.

VALIDACAO
O pacote final inclui VALIDATION-20X.txt quando os 20 ciclos reais de conexao/desconexao passam no runner Windows.

LIMITES
A rede Tor escolhe um relay de saida dentro do pais solicitado; isso nao garante cidade ou IP fixo.
Nenhum VPN pode garantir que uma plataforma de terceiros aceite, classifique ou mantenha uma conta em determinada regiao.
