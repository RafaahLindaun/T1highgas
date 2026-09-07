# HighGAS VPN

HighGAS é um frontend pessoal, sem login, feito em React + Vite para organizar uma configuração VPN baseada em WireGuard.

## O que esta versão faz

- interface responsiva para celular, Mac e PC;
- seleção de país/servidor;
- importação local de perfil WireGuard `.conf`;
- o conteúdo do perfil fica apenas na memória do navegador e não é enviado ao Supabase;
- diagnóstico de IP/país pela rota `/api/network-info`;
- catálogo de servidores vindo de um projeto Supabase separado;
- fallback local para o site continuar utilizável se o Supabase estiver indisponível;
- sem autenticação e sem dependência do backend antigo do repositório.

## Limite técnico importante

Um navegador não pode criar um túnel VPN de sistema por conta própria. O HighGAS organiza o perfil e verifica a saída, enquanto o túnel real é ativado no aplicativo WireGuard do sistema operacional.

## Supabase

Crie um projeto Supabase separado e aplique `supabase/highgas.sql`.

Depois configure:

```env
VITE_HIGHGAS_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_HIGHGAS_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
```

A tabela `highgas_servers` é pública somente para leitura e usa RLS. Não armazene chaves privadas, perfis `.conf` ou segredos na tabela.

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
