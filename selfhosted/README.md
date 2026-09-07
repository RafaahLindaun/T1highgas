# HighGAS Self-hosted

Este modo transforma o HighGAS em uma VPN realmente sua, usando WireGuard e uma máquina Linux que você controla.

## Custo

O software é gratuito e não depende de assinatura de VPN. Para custo adicional mensal igual a zero, use uma máquina/roteador e uma conexão de internet que você já possui.

A VPN sempre precisa de um ponto de saída real ligado à internet. Sem uma máquina em outro país, o HighGAS não pode criar magicamente uma saída naquele país. Cada país exibido como disponível deve corresponder a um servidor real.

## Requisitos do servidor

- Debian ou Ubuntu
- máquina ligada enquanto você quiser usar a VPN
- acesso administrativo (`sudo`)
- porta UDP 51820 liberada no firewall
- se estiver atrás de roteador/NAT: encaminhar UDP 51820 para o IP local da máquina
- idealmente um IP público acessível. Se o provedor usa CGNAT, será necessário IPv6 público, mudança na conexão ou outro ponto de saída.

## Instalação

```bash
chmod +x install-server.sh add-client.sh remove-client.sh status.sh
sudo ./install-server.sh
sudo ./add-client.sh macbook
```

O perfil gerado fica em:

```text
/etc/highgas/clients/macbook.conf
```

Esse arquivo contém a chave privada do cliente. Ele deve ser transferido apenas para o dispositivo correspondente e nunca deve ser commitado no GitHub, salvo no Neon ou enviado para a Vercel.

## Remover um cliente

```bash
sudo ./remove-client.sh macbook
```

## Verificar o servidor

```bash
sudo ./status.sh
```

## Arquitetura

```text
Mac / celular
    |
    | WireGuard criptografado
    v
HighGAS Server próprio
    |
    v
Internet
```

O site HighGAS e o helper local servem como painel/controle. O túnel de rede é estabelecido diretamente entre seu dispositivo e o servidor WireGuard que você controla.
