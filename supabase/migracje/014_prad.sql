-- 014 (wersja 0.20.0). Uruchomić w Supabase → SQL Editor po 013 (ponowne uruchomienie nic nie psuje).
-- Jednostki z doprowadzonym prądem (prośba z 12.11.2026): zapisane w umowie, rachunki za prąd rozliczane raz na kwartał.
--  * units.has_power – znacznik „prąd” (kafelek, szczegóły, karta klienta, filtr „Z prądem”, pole umowy {{prad}}).
--    Kolumna dopuszcza null (= false), więc kopie zapasowe sprzed tej wersji wczytują się bez zmian (wczytaj_kopie).
--  * Oznaczenie 15 jednostek: K14R3–K19R3 i G12R1–G20R1 (numery bez względu na wielkość liter, spacje i myślniki).

alter table public.units add column if not exists has_power boolean default false;

comment on column public.units.has_power is
  'Doprowadzony prąd (zapisany w umowie); rachunki za prąd rozliczane raz na kwartał';

update public.units set has_power = true
where upper(regexp_replace(code, '[\s-]', '', 'g')) in (
  'K14R3', 'K15R3', 'K16R3', 'K17R3', 'K18R3', 'K19R3',
  'G12R1', 'G13R1', 'G14R1', 'G15R1', 'G16R1', 'G17R1', 'G18R1', 'G19R1', 'G20R1');

-- Sprawdzenie: powinno być 15 wierszy (mniej = któregoś numeru nie ma w bazie albo ma inny zapis).
select code, type, has_power from public.units where has_power order by code;
