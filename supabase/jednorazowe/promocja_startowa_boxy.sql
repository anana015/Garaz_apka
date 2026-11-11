-- =====================================================================
-- JEDNORAZOWO (11.11.2026): „Promocja startowa −50% / 2 mies.” dla trwających najmów boxów
-- (box_duzy i box_maly). Supabase → SQL Editor → wklej cały plik → Run.
--
-- KROK 1: uruchom bez zmian (zapisz = false) – nic nie zapisuje, pokazuje tabelę z planem.
-- KROK 2: sprawdź kolumnę „status”, w linii oznaczonej „← KROK 2” zmień false na true i uruchom jeszcze raz.
-- Ponowne uruchomienie z true nic nie psuje – najmy z promocją są pomijane.
-- Przed krokiem 2 warto zapisać kopię zapasową (Ustawienia → Dane → Zapisz kopię).
--
-- Co robi (tak samo jak formularz „Promocja” w aplikacji, js/promocje.js):
--  - stawka promocyjna (−50% stawki normalnej, do pełnych zł) od dnia startu najmu,
--  - stawka normalna od pierwszego okresu po promocji: dzień płatności (20.) dwa miesiące po miesiącu startu,
--    np. start 05.09 → promocja 05.09–19.11, normalnie od 20.11; start 25.09 → promocja 25.09–19.11;
--  - stawki wpisane w trakcie promocji (np. podwyżka 01.02.2026) są usuwane – ich kwota przechodzi na
--    stawkę po promocji;
--  - stawka normalna = stawka z historii najmu; gdy w historii jest stawka promocyjna (≤ połowa ceny
--    regularnej, np. 100 zł / 90 zł) albo brak stawki – cena regularna: duży box 200 zł, mały 180 zł.
-- Pomija:
--  - najmy zakończone (end_on przed dziś),
--  - najmy, w których promocja skończyła się przed datą startu danych (01.01.2026) – te okresy są w saldzie
--    otwarcia, więc zmiana stawek nic by nie zmieniła w rozliczeniach,
--  - najmy, które mają już promocję w historii stawek (np. dodaną w aplikacji albo tym skryptem),
--  - najmy ze stawką promocyjną DZIŚ, choć według daty startu promocja już minęła – do sprawdzenia ręcznie
--    (inaczej od końca promocji powstałaby zaległość 100/90 zł miesięcznie).
-- UWAGA: klient, który w pierwszych dwóch miesiącach płacił pełną stawkę, po zmianie będzie miał nadpłatę.
-- =====================================================================

drop table if exists pg_temp.promo_plan;
drop table if exists pg_temp.promo_param;

create temp table promo_param as select
  false as zapisz,                                     -- ← KROK 2: zmień na true
  50 as rabat,                                         -- %
  2 as okresy,                                         -- liczba okresów po niepełnym pierwszym
  20000 as regularna_box_duzy_gr,                      -- 200 zł
  18000 as regularna_box_maly_gr,                      -- 180 zł
  'Promocja startowa −50% / 2 mies.'::text as nazwa;

-- Dzień płatności w miesiącu (początek miesiąca m + n miesięcy); w krótszym miesiącu ostatni dzień (Z5).
create or replace function pg_temp.dzien_platnosci(m date, n int, dzien int) returns date
language sql immutable as $$
  select x + least(dzien, extract(day from (x + interval '1 month' - interval '1 day'))::int) - 1
  from (select (date_trunc('month', m) + make_interval(months => n))::date as x) q
$$;

create temp table promo_plan as
with p as (select * from promo_param),
najmy as (
  select r.id, r.user_id, r.start_on, r.end_on, r.billing_day as dzien, r.period_months as dlugosc,
         u.code as jednostka, u.type as typ, c.name as klient,
         case u.type when 'box_duzy' then p.regularna_box_duzy_gr else p.regularna_box_maly_gr end as regularna,
         coalesce(st.data_start, date '2026-01-01') as data_start
  from public.rentals r
  join public.units u on u.id = r.unit_id
  join public.contracts k on k.id = r.contract_id
  join public.clients c on c.id = k.client_id
  left join public.settings st on st.user_id = r.user_id
  cross join p
  where u.type in ('box_duzy', 'box_maly')
    and (r.end_on is null or r.end_on >= current_date)
),
-- kotwica = pierwszy dzień płatności od startu (początek pierwszego pełnego okresu),
-- granica = dzień płatności „okresy” okresów po miesiącu startu (js/promocje.js → planPromocji)
kotwice as (
  select n.*,
    case when pg_temp.dzien_platnosci(n.start_on, 0, n.dzien) >= n.start_on
         then pg_temp.dzien_platnosci(n.start_on, 0, n.dzien)
         else pg_temp.dzien_platnosci(n.start_on, 1, n.dzien) end as kotwica,
    pg_temp.dzien_platnosci(n.start_on, (select okresy from p) * n.dlugosc, n.dzien) as granica
  from najmy n
),
-- koniec promocji = początek pierwszego okresu od granicy
konce as (
  select k.*,
    (select min(pg_temp.dzien_platnosci(k.kotwica, g * k.dlugosc, k.dzien)) from generate_series(0, 60) g
     where pg_temp.dzien_platnosci(k.kotwica, g * k.dlugosc, k.dzien) >= k.granica) as koniec_wyliczony
  from kotwice k
),
stawki as (
  select k.*,
    case when k.end_on is not null and k.koniec_wyliczony > k.end_on then null else k.koniec_wyliczony end as koniec,
    round(k.regularna * (100 - (select rabat from p)) / 10000.0) * 100 as polowa_regularnej,
    (select amount_gr from public.rental_rates rr where rr.rental_id = k.id and rr.valid_from <= k.start_on
       order by valid_from desc limit 1) as stawka_start,
    (select amount_gr from public.rental_rates rr where rr.rental_id = k.id and rr.valid_from <= k.koniec_wyliczony
       order by valid_from desc limit 1) as stawka_koniec,
    (select amount_gr from public.rental_rates rr where rr.rental_id = k.id and rr.valid_from <= current_date
       order by valid_from desc limit 1) as stawka_dzis,
    exists (select 1 from public.rental_rates rr where rr.rental_id = k.id and rr.reason ilike 'promocja%') as ma_promocje
  from konce k
),
wyliczone as (
  select s.*,
    case when s.stawka_start is null or s.stawka_start <= s.polowa_regularnej then s.regularna else s.stawka_start end as normalna_start,
    case when s.stawka_koniec is null or s.stawka_koniec <= s.polowa_regularnej then s.regularna else s.stawka_koniec end as normalna_po
  from stawki s
)
select w.*,
  (round(w.normalna_start * (100 - (select rabat from p)) / 10000.0) * 100)::int as promocyjna,
  case
    when w.ma_promocje then 'pominięty: ma już promocję w historii stawek'
    when w.koniec is not null and w.koniec <= w.data_start then 'pominięty: promocja przed datą startu danych'
    when w.stawka_dzis <= w.polowa_regularnej and w.koniec is not null and w.koniec <= current_date
      then 'DO SPRAWDZENIA: dziś stawka promocyjna, a promocja już minęła'
    else 'zapisz'
  end as status
from wyliczone w, p;

do $$
begin
  if not (select zapisz from promo_param) then
    return;
  end if;

  -- stawki wpisane w trakcie promocji (po starcie, przed końcem)
  delete from public.rental_rates rr
  using promo_plan pl
  where pl.status = 'zapisz' and rr.rental_id = pl.id
    and rr.valid_from > pl.start_on and (pl.koniec is null or rr.valid_from < pl.koniec);

  -- stawka promocyjna od startu
  insert into public.rental_rates (user_id, rental_id, valid_from, amount_gr, reason)
  select pl.user_id, pl.id, pl.start_on, pl.promocyjna, (select nazwa from promo_param)
  from promo_plan pl where pl.status = 'zapisz'
  on conflict (rental_id, valid_from) do update set amount_gr = excluded.amount_gr, reason = excluded.reason;

  -- stawka normalna od pierwszego okresu po promocji
  insert into public.rental_rates (user_id, rental_id, valid_from, amount_gr, reason)
  select pl.user_id, pl.id, pl.koniec, pl.normalna_po, 'koniec promocji'
  from promo_plan pl where pl.status = 'zapisz' and pl.koniec is not null
  on conflict (rental_id, valid_from) do update set amount_gr = excluded.amount_gr,
    reason = case when public.rental_rates.amount_gr = excluded.amount_gr then public.rental_rates.reason else excluded.reason end;
end $$;

-- Wynik: plan (zapisz = false) albo to, co zapisano (zapisz = true).
select
  status,
  klient,
  jednostka,
  case typ when 'box_duzy' then 'duży' else 'mały' end as box,
  to_char(start_on, 'DD.MM.YYYY') as start_najmu,
  to_char(start_on, 'DD.MM.YYYY') || ' – ' || coalesce(to_char(koniec - 1, 'DD.MM.YYYY'), 'koniec najmu') as promocja,
  to_char(stawka_dzis / 100.0, 'FM999990') || ' zł' as stawka_dzis_przed,
  to_char(promocyjna / 100.0, 'FM999990') || ' zł' as stawka_promocyjna,
  coalesce(to_char(koniec, 'DD.MM.YYYY'), '—') as normalna_od,
  to_char(normalna_po / 100.0, 'FM999990') || ' zł' as stawka_normalna,
  (select count(*) from public.rental_rates rr where rr.rental_id = promo_plan.id) as stawek_w_historii,
  case when (select zapisz from promo_param) and status = 'zapisz' then 'ZAPISANO' else 'tylko podgląd' end as wynik
from promo_plan
order by case when status like 'DO%' then 0 when status = 'zapisz' then 1 else 2 end, jednostka;
