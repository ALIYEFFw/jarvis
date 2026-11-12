-- ============================================================
--  JARVIS — Supabase verilənlər bazası
--  Supabase Dashboard → SQL Editor → bu faylı yapışdır → Run
-- ============================================================

-- 1) Söhbət mesajları (sənin və JARVIS-in yazdıqları)
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

-- 2) Tapşırıqlar və xatırlatmalar
create table if not exists public.tasks (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  due_at      timestamptz,
  done        boolean not null default false,
  notified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists tasks_user_due_idx
  on public.tasks (user_id, done, due_at);

-- 3) Təhlükəsizlik: hər kəs YALNIZ öz sətirlərini görür (Row Level Security)
alter table public.messages enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "messages_own_rows" on public.messages;
create policy "messages_own_rows" on public.messages
  for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tasks_own_rows" on public.tasks;
create policy "tasks_own_rows" on public.tasks
  for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 4) Daxil olmuş istifadəçiyə cədvəllərlə işləmək icazəsi
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.tasks    to authenticated;
grant usage, select on all sequences in schema public to authenticated;
