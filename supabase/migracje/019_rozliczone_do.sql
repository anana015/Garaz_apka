-- 019 (wersja 0.26.0). Uruchomić w Supabase → SQL Editor po 018 (ponowne uruchomienie nic nie psuje).
-- Prośba z 20.11.2026: wszyscy dotychczasowi klienci mają uregulowane płatności do końca września 2026.
-- Wyciągi z całego roku są wczytane, ale wpłat sprzed października nie łączymy z klientami.
--
-- settings.settled_through („Rozliczone do”): wszystko do tej daty jest uznane za rozliczone:
--   - należności z terminem do tej daty = opłacone (bez łączenia wpłat),
--   - wpłaty z datą do tej daty nie wchodzą do rozliczeń klientów i nie czekają na przypisanie,
--   - saldo otwarcia klientów (stan na 01.01.2026) przestaje się liczyć.
-- Przychód w Raportach, ryczałt i limity VAT liczą wpłaty jak dotąd (także te sprzed października).
-- Zmiana lub wyłączenie: Ustawienia → Rozliczenia → „Rozliczone do” (puste = wyłączone). Dane w bazie się nie zmieniają.

alter table public.settings add column if not exists settled_through date;

update public.settings set settled_through = date '2026-09-30' where settled_through is null;

select user_id, data_start, settled_through from public.settings;
