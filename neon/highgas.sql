-- HighGAS Neon Postgres schema
-- Never store WireGuard private keys or .conf profile contents here.

create table if not exists public.highgas_servers (
  id bigserial primary key,
  code text not null unique,
  country_code text not null,
  country_name text not null,
  city text not null,
  label text not null,
  endpoint text,
  protocol text not null default 'wireguard',
  status text not null default 'online',
  is_recommended boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists highgas_servers_active_sort_idx
  on public.highgas_servers (is_active, sort_order, country_name, city);

alter table public.highgas_servers enable row level security;

grant usage on schema public to anonymous;
grant select on table public.highgas_servers to anonymous;

drop policy if exists "Public can read active HighGAS servers"
  on public.highgas_servers;

create policy "Public can read active HighGAS servers"
on public.highgas_servers
for select
to anonymous
using (is_active = true);
