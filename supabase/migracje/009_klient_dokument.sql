-- 009 (wersja 0.14.0). Uruchomić RAZ w Supabase → SQL Editor po 008 (ponowne uruchomienie nic nie psuje).
-- Dokument tożsamości i PESEL klienta (prośba 11.11.2026 – zmienia Z35 ze specyfikacji, która ich nie przewidywała).
-- Dane osobowe: chronione RLS jak reszta tabeli clients; nie trafiają do eksportów CSV, są w kopii zapasowej JSON.

alter table public.clients add column if not exists doc_type text
  check (doc_type in ('dowod', 'paszport', 'karta_pobytu', 'inny'));
alter table public.clients add column if not exists doc_number text check (char_length(doc_number) <= 30);
alter table public.clients add column if not exists pesel text check (pesel ~ '^[0-9]{11}$');

create unique index if not exists clients_pesel_unikalny on public.clients (user_id, pesel) where pesel is not null;
