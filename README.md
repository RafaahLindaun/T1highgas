# HighGAS VPN

HighGAS é um frontend pessoal, sem login, feito em React + Vite para organizar uma configuração VPN baseada em WireGuard.

## O que esta versão faz

- interface responsiva para celular, Mac e PC;
- seleção de país/servidor;
- importação local de perfil WireGuard `.conf`;
- o conteúdo do perfil fica apenas na memória do navegador;
- diagnóstico de IP/país pela rota `/api/network-info`;
- catálogo de servidores armazenado em Neon Postgres;
- rota `/api/servers` como camada entre o frontend e o banco;
- fallback local para o site continuar utilizável se o catálogo remoto estiver indisponível;
- sem login e sem dependência do backend antigo do repositório.

## Limite técnico importante

Um navegador não pode criar um túnel VPN de sistema por conta própria. O HighGAS organiza o perfil e verifica a saída, enquanto o túnel real é ativado no aplicativo WireGuard do sistema operacional.

## Neon

O backend oficial é o projeto Neon `HighGAS`, PostgreSQL 17 na região `aws-sa-east-1`.

A tabela `highgas_servers` guarda somente metadados públicos do catálogo: país, cidade, protocolo, status e ordenação. Perfis `.conf`, chaves privadas e senhas nunca devem ser armazenados nessa tabela.

A aplicação possui um catálogo local de fallback para continuar abrindo caso o backend esteja temporariamente indisponível.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

O frontend foi mantido propositalmente pequeno para reduzir pontos de falha.
