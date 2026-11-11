-- 012 (wersja 0.18.0). Uruchomić w Supabase → SQL Editor po 011 (ponowne uruchomienie nic nie psuje).
-- Bramy GSM (prośba z 11.11.2026): numer telefonu klienta dopisywany do sterownika bramy SMS-em z poleceniem.
--  * gates – sterowniki bram: numer bramy, numer karty SIM, hasło, szablony poleceń, pierwsza pozycja (200).
--    Dane wpisuje się w Supabase (supabase/jednorazowe/bramy_wpisz.sql), nie w kodzie aplikacji – kod może być publiczny.
--  * gate_access – kto ma dostęp do której bramy: telefon, pozycja w sterowniku, od kiedy, kiedy usunięty.
-- RLS jak w pozostałych tabelach: tylko właściciel konta; anon bez dostępu.
-- wczytaj_kopie: kopia zapasowa obejmuje też obie nowe tabele.

create table if not exists public.gates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  numer smallint not null check (numer between 1 and 9),        -- 1 = rzędy R1–R4, 2 = boxy
  nazwa text not null default '',
  sim_phone text not null check (sim_phone ~ '^\+?[0-9]{9,15}$'),   -- numer karty SIM w sterowniku
  password text not null default '',                              -- hasło sterownika ({haslo} w poleceniu)
  add_template text,           -- null = '{haslo}#TEL#{telefon}#{pozycja}#'
  remove_template text,        -- polecenie usunięcia z instrukcji sterownika, np. z {pozycja}
  client_message text,         -- SMS do klienta po przypisaniu; null = tekst domyślny aplikacji
  first_slot integer not null default 200 check (first_slot >= 0),
  max_slot integer check (max_slot is null or max_slot >= first_slot),
  created_at timestamptz not null default now(),
  unique (user_id, numer)
);

create table if not exists public.gate_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  gate_id uuid not null references public.gates on delete restrict,
  client_id uuid not null references public.clients on delete cascade,
  phone text not null check (phone ~ '^\+?[0-9]{9,15}$'),
  slot integer check (slot >= 0),                 -- null = wpisany do sterownika wcześniej, pozycja nieznana
  added_on date not null,
  removed_on date,
  note text,
  created_at timestamptz not null default now(),
  check (removed_on is null or removed_on >= added_on)
);
create unique index if not exists gate_access_pozycja on public.gate_access (user_id, gate_id, slot)
  where removed_on is null and slot is not null;
create index if not exists gate_access_klient on public.gate_access (client_id);
create index if not exists gate_access_user on public.gate_access (user_id);

alter table public.gates enable row level security;
alter table public.gate_access enable row level security;
drop policy if exists own_rows on public.gates;
create policy own_rows on public.gates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists own_rows on public.gate_access;
create policy own_rows on public.gate_access for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.gates, public.gate_access from anon;
grant select, insert, update, delete on public.gates, public.gate_access to authenticated;

create or replace function public.wczytaj_kopie(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t text;
  n integer;
  wynik jsonb := '{}'::jsonb;
  -- kolejność wstawiania: najpierw tabele, na które wskazują inne (klucze obce)
  kolejnosc constant text[] := array['units', 'clients', 'bank_accounts', 'imports', 'contracts', 'rentals',
    'rental_rates', 'charge_adjustments', 'payments', 'payers', 'deposits', 'client_notes', 'tax_payments', 'settings',
    'expenses', 'cost_rules', 'gates', 'gate_access'];
begin
  if uid is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = '42501';
  end if;

  -- Usuwanie w odwrotnej kolejności (najpierw wiersze wskazujące na inne).
  for i in reverse array_length(kolejnosc, 1) .. 1 loop
    execute format('delete from public.%I where user_id = $1', kolejnosc[i]) using uid;
  end loop;

  foreach t in array kolejnosc loop
    execute format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1)', t)
      using (select coalesce(jsonb_agg(e || jsonb_build_object('user_id', uid)), '[]'::jsonb)
             from jsonb_array_elements(coalesce(p->t, '[]'::jsonb)) e);
    get diagnostics n = row_count;
    wynik := wynik || jsonb_build_object(t, n);
  end loop;

  -- Kopia bez ustawień (np. z pustego konta): wiersz z wartościami domyślnymi.
  insert into public.settings (user_id) values (uid) on conflict (user_id) do nothing;
  return wynik;
end;
$$;

revoke all on function public.wczytaj_kopie(jsonb) from public;
revoke all on function public.wczytaj_kopie(jsonb) from anon;
grant execute on function public.wczytaj_kopie(jsonb) to authenticated;
