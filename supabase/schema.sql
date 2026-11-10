-- =====================================================================
-- Najem magazynów – schemat bazy (specyfikacja, rozdział 4)
-- Uruchomić raz w Supabase → SQL Editor (cały plik). Testy: tests/schema.test.js (PGlite).
--
-- Zasady:
--  - kwoty w groszach (integer), daty bez godziny (date), Z37;
--  - każdy wiersz ma user_id = auth.uid(), każda tabela RLS z polityką own_rows (rozdz. 11);
--  - należności, salda i statusy NIE są zapisywane – liczy je aplikacja (Z38);
--  - klienta, jednostki ani umowy z historią nie da się usunąć (on delete restrict) – archiwizacja.
--
-- Różnice względem SQL ze specyfikacji (README → „Różnice względem specyfikacji”):
--  contracts.archived, settings.default_last_period, settings.last_backup_at, bank_accounts.csv_profile,
--  RLS na wszystkich 14 tabelach, anon bez dostępu, bucket „umowy” tworzony w skrypcie.
--
-- Zmiany po pierwszym uruchomieniu są w supabase/migracje/ (uruchamiać po kolei, każdą raz).
-- Nowa instalacja: najpierw ten plik, potem wszystkie migracje.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Jednostki, klienci, umowy, najmy
-- ---------------------------------------------------------------------

create table public.units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  code text not null,                                              -- np. G-03
  type text not null                                               -- decyzja 3 (10.11.2026): box duży i mały
    constraint units_type_check check (type in ('kontener', 'garaz', 'box_duzy', 'box_maly')),
  area_m2 numeric(6,2),
  list_price_gr integer check (list_price_gr >= 0),                -- cennik, miesięcznie
  description text,
  out_of_service boolean not null default false,                   -- remont, wyłączona z najmu
  sort_order integer not null default 0,
  archived boolean not null default false,
  unique (user_id, code)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  kind text not null default 'osoba' check (kind in ('osoba', 'firma')),
  name text not null,                                              -- imię i nazwisko albo nazwa firmy
  contact_person text,
  nip text check (nip ~ '^[0-9]{10}$'),
  address text,
  phone text,
  email text,
  note text,
  opening_balance_gr integer not null default 0,                   -- na dzień data_start: ujemne = zaległość
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid not null references public.clients on delete restrict,
  number text,
  signed_on date,
  valid_until date,                                                -- puste = czas nieokreślony
  notice_period text,                                              -- np. „1 miesiąc”, informacyjnie
  pdf_path text,                                                   -- {user_id}/{id}.pdf w buckecie umowy
  note text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  contract_id uuid not null references public.contracts on delete restrict,
  unit_id uuid not null references public.units on delete restrict,
  start_on date not null,
  end_on date,                                                     -- faktyczny koniec; puste = trwa
  billing_day smallint not null check (billing_day between 1 and 31),
  period_months smallint not null default 1 check (period_months in (1, 3, 6, 12)),
  last_period text not null default 'proporcjonalnie'
    check (last_period in ('proporcjonalnie', 'pelny')),
  check (end_on is null or end_on >= start_on),
  -- jedna jednostka nie może mieć dwóch najmów w tym samym czasie (test akceptacyjny 16)
  constraint rentals_no_overlap
    exclude using gist (unit_id with =, daterange(start_on, end_on, '[]') with &&)
);

create table public.rental_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  rental_id uuid not null references public.rentals on delete cascade,
  valid_from date not null,
  amount_gr integer not null check (amount_gr > 0),                -- miesięcznie
  reason text,                                                     -- start, podwyżka, rabat
  unique (rental_id, valid_from)
);

create table public.charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  rental_id uuid not null references public.rentals on delete cascade,
  period_start date not null,                                      -- początek okresu, którego dotyczy
  amount_gr integer not null,                                      -- ujemna = obniżka lub umorzenie
  reason text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Konta, importy, wpłaty, płatnicy
-- ---------------------------------------------------------------------

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,                                              -- np. „Nest – najem”
  bank text not null,                                              -- nest, pekao, pko, alior, inny
  iban text check (iban ~ '^[0-9]{26}$'),
  csv_profile jsonb,                                               -- ręczne mapowanie kolumn (7.1)
  archived boolean not null default false
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  bank_account_id uuid references public.bank_accounts,
  file_name text,
  imported_at timestamptz not null default now(),
  rows_total int, rows_added int, rows_duplicate int, rows_outflow int, rows_error int
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  booked_on date not null,                                         -- data księgowania
  amount_gr integer not null check (amount_gr <> 0),               -- ujemna = zwrot nadpłaty (Z24)
  kind text not null default 'czynsz'
    check (kind in ('czynsz', 'kaucja', 'przychod_inny', 'pominieta')),
  method text not null default 'przelew' check (method in ('przelew', 'gotowka', 'kaucja')),
  bank_account_id uuid references public.bank_accounts,
  counterparty text,
  title text,
  payer_account text check (payer_account ~ '^[0-9]{26}$'),        -- 26 cyfr rachunku nadawcy
  client_id uuid references public.clients on delete restrict,
  contract_id uuid references public.contracts,                    -- dla kaucji
  match_method text check (match_method in ('rachunek', 'nazwa', 'jednostka', 'reczne')),
  match_confirmed boolean not null default false,
  note text,
  dedup_key text,                                                  -- tylko wpłaty z wyciągu (5.9)
  import_id uuid references public.imports,
  created_at timestamptz not null default now()
);
create unique index payments_dedup on public.payments (user_id, dedup_key) where dedup_key is not null;

create table public.payers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid not null references public.clients on delete cascade,
  account text check (account ~ '^[0-9]{26}$'),
  name_key text,                                                   -- nazwa bez ogonków, wielkie litery
  label text,                                                      -- np. „mąż”, „firma”
  created_at timestamptz not null default now(),
  check (account is not null or name_key is not null),
  unique (user_id, account),
  unique (user_id, name_key)
);

-- ---------------------------------------------------------------------
-- Kaucje, notatki, podatek, ustawienia
-- ---------------------------------------------------------------------

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  contract_id uuid not null references public.contracts on delete cascade,
  kind text not null check (kind in ('przyjecie', 'zwrot', 'zatrzymanie')),
  amount_gr integer not null check (amount_gr > 0),
  method text not null default 'gotowka' check (method in ('gotowka', 'przelew')),
  on_date date not null,
  reason text,                                                     -- przy zatrzymaniu: zaległy czynsz, szkody
  payment_id uuid references public.payments on delete set null,
  created_at timestamptz not null default now()
);

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_id uuid not null references public.clients on delete cascade,
  kind text not null default 'notatka'
    check (kind in ('notatka', 'telefon', 'sms', 'email', 'obietnica')),
  body text not null,
  promised_on date,                                                -- „obiecał zapłacić do…”
  promised_gr integer,
  created_at timestamptz not null default now()
);

create table public.tax_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  year smallint not null,
  quarter smallint not null check (quarter between 1 and 4),
  paid_on date not null,
  amount_gr integer not null check (amount_gr >= 0),
  unique (user_id, year, quarter)
);

create table public.settings (
  user_id uuid primary key default auth.uid(),
  tolerance_days smallint not null default 3,
  punctuality_months smallint not null default 12,
  expiring_days smallint not null default 30,
  default_last_period text not null default 'proporcjonalnie'
    check (default_last_period in ('proporcjonalnie', 'pelny')),
  tax_period text not null default 'kwartal' check (tax_period in ('kwartal', 'miesiac')),
  tax_rate_low_bp integer not null default 850,                    -- 8,5%
  tax_rate_high_bp integer not null default 1250,                  -- 12,5%
  tax_threshold_gr bigint not null default 10000000,               -- 100 000 zł
  vat_limit_gr bigint not null default 24000000,                   -- 240 000 zł (od 2026)
  tax_account text,                                                -- mikrorachunek podatkowy
  data_start date not null default '2026-01-01',
  last_backup_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Dostęp: RLS na każdej tabeli, tylko zalogowany właściciel wierszy (rozdz. 11)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['units', 'clients', 'contracts', 'rentals', 'rental_rates',
    'charge_adjustments', 'bank_accounts', 'imports', 'payments', 'payers', 'deposits',
    'client_notes', 'tax_payments', 'settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- (select auth.uid()) zamiast auth.uid(): wynik liczony raz na zapytanie, nie dla każdego wiersza.
    execute format('create policy own_rows on public.%I for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Supabase domyślnie nadaje rolom anon i authenticated pełne prawa do nowych tabel.
-- Aplikacja ma jednego, zalogowanego użytkownika: anon nie dostaje nic.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------
-- Pliki umów: prywatny bucket „umowy”, tylko PDF do 10 MB (formularz 8.6),
-- pliki w folderze {user_id}/, otwierane podpisanym linkiem ważnym 60 s (rozdz. 11).
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('umowy', 'umowy', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy umowy_wlasny_folder on storage.objects for all to authenticated
  using (bucket_id = 'umowy' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'umowy' and (storage.foldername(name))[1] = (select auth.uid())::text);
