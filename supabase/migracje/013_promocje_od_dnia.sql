-- 013 (wersja 0.19.0). Uruchomić w Supabase → SQL Editor po 012 (ponowne uruchomienie nic nie psuje).
-- Nowa reguła promocji (prośba z 12.11.2026):
--  * start 1.–10. dnia: bieżący miesiąc = 1. miesiąc promocji;
--  * start 11.–22.: promocja do tego samego dnia za N miesięcy, od następnego dnia normalna stawka – miesiąc
--    dzielony na części (proporcjonalnie, do pełnych 10 zł), np. styczeń 40 zł + 120 zł;
--  * start od 23.: końcówka miesiąca gratis, potem N pełnych miesięcy z rabatem.
-- Zmiany:
--  * rental_rates.from_day – stawka obowiązuje od swojego dnia (dzieli miesiąc), a nie od następnego okresu.
--    Kolumna dopuszcza null (= false), więc kopie zapasowe sprzed tej wersji wczytują się bez zmian (wczytaj_kopie).
--  * rental_rates.amount_gr może być 0 (końcówka miesiąca gratis).
--  * zapisz_pakiet zapisuje from_day (nowy najem z promocją). Reszta funkcji bez zmian (jak w 001).

alter table public.rental_rates add column if not exists from_day boolean default false;

comment on column public.rental_rates.from_day is
  'true = stawka od tego dnia (miesiąc dzielony proporcjonalnie, części do 10 zł); false = od następnego okresu';

alter table public.rental_rates drop constraint if exists rental_rates_amount_gr_check;
alter table public.rental_rates drop constraint if exists rental_rates_kwota;
alter table public.rental_rates add constraint rental_rates_kwota check (amount_gr >= 0);

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
    insert into public.rental_rates (id, rental_id, valid_from, amount_gr, reason, from_day)
    select coalesce(x.id, gen_random_uuid()), x.rental_id, x.valid_from, x.amount_gr, x.reason, coalesce(x.from_day, false)
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

