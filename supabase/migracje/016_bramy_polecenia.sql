-- 016 (wersja 0.22.0). Uruchomić w Supabase → SQL Editor (ponowne uruchomienie nic nie psuje).
-- Polecenia sterowników bram i SMS do klienta (prośba z 12.11.2026), dla obu bram:
--  * dodanie numeru:  {haslo}#TEL{telefon9}#{pozycja}#   np. 1234#TEL600111222#205#
--  * usunięcie:       {haslo}#DEL{telefon9}#{pozycja}#   np. 1234#DEL600111222#205#
--    ({telefon9} = numer klienta bez +48, same cyfry)
--  * SMS do klienta – null = tekst z aplikacji (js/bramy.js, DOMYSLNA_WIADOMOSC):
--      Dzień dobry,
--      aby otworzyć bramę przy ul. Nad Drwiną 11A proszę zadzwonić pod numer {numer_bramy}.
--      Pozdrawiam
--      Jakub Chwaja
--    Przy usunięciu z bramy klient nie dostaje SMS-a.
-- Hasła i numery SIM bez zmian.

update public.gates set
  add_template = '{haslo}#TEL{telefon9}#{pozycja}#',
  remove_template = '{haslo}#DEL{telefon9}#{pozycja}#',
  client_message = null;

select numer, nazwa, sim_phone, add_template, remove_template, client_message from public.gates order by numer;
