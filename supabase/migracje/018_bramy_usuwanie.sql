-- 018 (wersja 0.25.0). Uruchomić w Supabase → SQL Editor po 017 (ponowne uruchomienie nic nie psuje).
-- Prośba z 13.11.2026: usunięcie numeru ze sterownika bramy = wyczyszczenie pozycji poleceniem
--   {haslo}#TEL#{pozycja}#   (np. 1234#TEL#205#)
-- zamiast {haslo}#DEL4800{telefon9}#{pozycja}#. Dodawanie bez zmian: {haslo}#TEL4800{telefon9}#{pozycja}#.

update public.gates set remove_template = '{haslo}#TEL#{pozycja}#';

select numer, add_template, remove_template from public.gates order by numer;
