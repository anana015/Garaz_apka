-- =====================================================================
-- Migracja 001 (wersja 0.2.0): 4 typy jednostek, funkcja zapisz_pakiet, dodatkowe ograniczenia, indeksy.
-- Uruchomić raz w Supabase → SQL Editor, na bazie utworzonej z supabase/schema.sql.
-- Każde polecenie sprawdza, czy zmiana już jest, więc ponowne uruchomienie niczego nie psuje.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Typy jednostek: decyzja 3 z 10.11.2026 – box rozdzielony na box_duzy i box_maly.
--    Ograniczenie units_type_check zawsze kończy z 4 typami, niezależnie od wersji schematu.
-- ---------------------------------------------------------------------

do $$
declare
  c record;
begin
  if exists (select 1 from public.units where type not in ('kontener', 'garaz', 'box_duzy', 'box_maly')) then
    raise exception 'Są jednostki z typem spoza listy (np. „box”). Zmień je na box_duzy albo box_maly i uruchom migrację ponownie.';
  end if;
  -- stare ograniczenie typu pod inną nazwą (np. z pierwszej wersji schematu)
  for c in select conname from pg_constraint
           where conrelid = 'public.units'::regclass and contype = 'c' and conname <> 'units_type_check'
             and pg_get_constraintdef(oid) like '%kontener%'
  loop
    execute format('alter table public.units drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.units'::regclass and conname = 'units_type_check'
                   and pg_get_constraintdef(oid) like '%box_maly%') then
    alter table public.units drop constraint if exists units_type_check;
    alter table public.units add constraint units_type_check
      check (type in ('kontener', 'garaz', 'box_duzy', 'box_maly'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Ograniczenia z formularzy 8.6 pilnowane także przez bazę
-- ---------------------------------------------------------------------

do $$
declare
  o record;
begin
  for o in select * from (values
    ('units', 'units_code_dlugosc', 'check (char_length(code) between 1 and 12)'),
    ('units', 'units_area_dodatnia', 'check (area_m2 > 0)'),
    ('clients', 'clients_name_dlugosc', 'check (char_length(name) between 1 and 80)'),
    ('charge_adjustments', 'charge_adjustments_kwota_niezerowa', 'check (amount_gr <> 0)'),
    ('charge_adjustments', 'charge_adjustments_powod', 'check (char_length(reason) > 0)'),
    ('bank_accounts', 'bank_accounts_bank', $c$check (bank in ('nest', 'pekao', 'pko', 'alior', 'inny'))$c$),
    ('client_notes', 'client_notes_body_dlugosc', 'check (char_length(body) between 1 and 500)'),
    ('settings', 'settings_zakresy', 'check (tolerance_days between 0 and 60
       and punctuality_months between 1 and 36 and expiring_days between 0 and 365
       and tax_rate_low_bp between 0 and 10000 and tax_rate_high_bp between 0 and 10000
       and tax_threshold_gr >= 0 and vat_limit_gr >= 0)'),
    ('settings', 'settings_tax_account', $c$check (tax_account ~ '^[0-9]{26}$')$c$)
  ) as v(tabela, nazwa, definicja)
  loop
    if not exists (select 1 from pg_constraint
                   where conname = o.nazwa and conrelid = format('public.%I', o.tabela)::regclass) then
      execute format('alter table public.%I add constraint %I %s', o.tabela, o.nazwa, o.definicja);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Indeksy: klucze obce (doradca Supabase „unindexed foreign keys”) i user_id (warunek RLS)
-- ---------------------------------------------------------------------

create index if not exists contracts_client_id_idx on public.contracts (client_id);
create index if not exists rentals_contract_id_idx on public.rentals (contract_id);
create index if not exists charge_adjustments_rental_id_idx on public.charge_adjustments (rental_id);
create index if not exists imports_bank_account_id_idx on public.imports (bank_account_id);
create index if not exists payments_client_id_idx on public.payments (client_id);
create index if not exists payments_contract_id_idx on public.payments (contract_id);
create index if not exists payments_bank_account_id_idx on public.payments (bank_account_id);
create index if not exists payments_import_id_idx on public.payments (import_id);
create index if not exists payers_client_id_idx on public.payers (client_id);
create index if not exists deposits_contract_id_idx on public.deposits (contract_id);
create index if not exists deposits_payment_id_idx on public.deposits (payment_id);
create index if not exists client_notes_client_id_idx on public.client_notes (client_id);

do $$
declare
  t text;
begin
  foreach t in array array['units', 'clients', 'contracts', 'rentals', 'rental_rates',
    'charge_adjustments', 'bank_accounts', 'imports', 'payments', 'payers', 'deposits',
    'client_notes', 'tax_payments']   -- settings: user_id jest kluczem głównym
  loop
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Funkcja zapisz_pakiet
-- Zapis kilku tabel w jednej transakcji: nowy najem (umowa, najem, stawka, kaucja),
-- zakończenie najmu z rozliczeniem kaucji, import danych startowych (7.5 – „wszystko albo nic”).
--
-- p = { units: [...], clients: [...], contracts: [...], rentals: [...], rental_rates: [...],
--       payments: [...], deposits: [...], rentals_end: [{ id, end_on, last_period }] }
-- Identyfikatory nadaje aplikacja (crypto.randomUUID), żeby wiersze mogły się do siebie odwoływać.
-- security invoker: działa z prawami zalogowanego użytkownika, więc obowiązuje RLS.
-- Zwraca zapisane wiersze w tym samym układzie (aplikacja dopisuje je do stanu bez pobierania wszystkiego).
-- ---------------------------------------------------------------------

create or replace function public.zapisz_pakiet(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wynik jsonb := '{}'::jsonb;
  r jsonb;
  pusta constant jsonb := '[]'::jsonb;
begin
  with w as (
    insert into public.units (id, code, type, area_m2, list_price_gr, description, out_of_service, sort_order)
    select coalesce(x.id, gen_random_uuid()), x.code, x.type, x.area_m2, x.list_price_gr, x.description,
           coalesce(x.out_of_service, false), coalesce(x.sort_order, 0)
    from jsonb_populate_recordset(null::public.units, coalesce(p->'units', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('units', r);

  with w as (
    insert into public.clients (id, kind, name, contact_person, nip, address, phone, email, note, opening_balance_gr)
    select coalesce(x.id, gen_random_uuid()), coalesce(x.kind, 'osoba'), x.name, x.contact_person, x.nip,
           x.address, x.phone, x.email, x.note, coalesce(x.opening_balance_gr, 0)
    from jsonb_populate_recordset(null::public.clients, coalesce(p->'clients', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('clients', r);

  with w as (
    insert into public.contracts (id, client_id, number, signed_on, valid_until, notice_period, pdf_path, note)
    select coalesce(x.id, gen_random_uuid()), x.client_id, x.number, x.signed_on, x.valid_until,
           x.notice_period, x.pdf_path, x.note
    from jsonb_populate_recordset(null::public.contracts, coalesce(p->'contracts', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('contracts', r);

  -- Zakończenie najmu przed nowymi najmami: zwolniona jednostka może od razu dostać kolejny najem.
  with w as (
    update public.rentals n
    set end_on = x.end_on, last_period = coalesce(x.last_period, n.last_period)
    from jsonb_populate_recordset(null::public.rentals, coalesce(p->'rentals_end', pusta)) x
    where n.id = x.id
    returning n.*)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;

  with w as (
    insert into public.rentals (id, contract_id, unit_id, start_on, end_on, billing_day, period_months, last_period)
    select coalesce(x.id, gen_random_uuid()), x.contract_id, x.unit_id, x.start_on, x.end_on, x.billing_day,
           coalesce(x.period_months, 1), coalesce(x.last_period, 'proporcjonalnie')
    from jsonb_populate_recordset(null::public.rentals, coalesce(p->'rentals', pusta)) x
    returning *)
  select r || coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('rentals', r);

  with w as (
    insert into public.rental_rates (id, rental_id, valid_from, amount_gr, reason)
    select coalesce(x.id, gen_random_uuid()), x.rental_id, x.valid_from, x.amount_gr, x.reason
    from jsonb_populate_recordset(null::public.rental_rates, coalesce(p->'rental_rates', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('rental_rates', r);

  -- Wpłaty przed kaucjami: zatrzymanie kaucji wskazuje swoją wpłatę (deposits.payment_id).
  with w as (
    insert into public.payments (id, booked_on, amount_gr, kind, method, bank_account_id, counterparty, title,
      payer_account, client_id, contract_id, match_method, match_confirmed, note, dedup_key, import_id)
    select coalesce(x.id, gen_random_uuid()), x.booked_on, x.amount_gr, coalesce(x.kind, 'czynsz'),
           coalesce(x.method, 'przelew'), x.bank_account_id, x.counterparty, x.title, x.payer_account,
           x.client_id, x.contract_id, x.match_method, coalesce(x.match_confirmed, false), x.note,
           x.dedup_key, x.import_id
    from jsonb_populate_recordset(null::public.payments, coalesce(p->'payments', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('payments', r);

  with w as (
    insert into public.deposits (id, contract_id, kind, amount_gr, method, on_date, reason, payment_id)
    select coalesce(x.id, gen_random_uuid()), x.contract_id, x.kind, x.amount_gr, coalesce(x.method, 'gotowka'),
           x.on_date, x.reason, x.payment_id
    from jsonb_populate_recordset(null::public.deposits, coalesce(p->'deposits', pusta)) x
    returning *)
  select coalesce(jsonb_agg(to_jsonb(w)), pusta) into r from w;
  wynik := wynik || jsonb_build_object('deposits', r);

  return wynik;
end;
$$;

revoke all on function public.zapisz_pakiet(jsonb) from public;
revoke all on function public.zapisz_pakiet(jsonb) from anon;
grant execute on function public.zapisz_pakiet(jsonb) to authenticated;

