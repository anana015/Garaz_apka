-- Bramy GSM – dane sterowników (wersja 0.18.0, po migracji 012). Uruchomić RAZ w Supabase → SQL Editor.
-- Hasła i numery kart SIM są tylko w bazie (RLS: widzi je wyłącznie Twoje konto), nie w kodzie aplikacji.
--
-- 1. Wpisz swój e-mail logowania (ten sam co w aplikacji).
-- 2. Zamień XXX na numery kart SIM w sterownikach (9 cyfr albo +48…) i HASLO na hasła sterowników.
-- 3. remove_template: polecenie USUNIĘCIA numeru z instrukcji sterownika. Pola do wstawienia:
--    {haslo}, {telefon} (+48…), {telefon9} (9 cyfr), {pozycja}. Zostaw null, jeśli nie znasz – aplikacja przypomni.
--    Polecenie dodania domyślnie: {haslo}#TEL#{telefon}#{pozycja}#  (zmień add_template, jeśli sterownik chce inaczej).
-- 4. Uruchom. Ponowne uruchomienie poprawia dane (on conflict … do update).

insert into public.gates (user_id, numer, nazwa, sim_phone, password, add_template, remove_template, first_slot)
select u.id, b.numer, b.nazwa, b.sim_phone, b.password, b.add_template, b.remove_template, 200
from auth.users u
cross join (values
  (1, 'Brama 1 (rzędy R1–R4)', '+48XXXXXXXXX', 'HASLO', null::text, null::text),
  (2, 'Brama 2 (boxy)',        '+48XXXXXXXXX', 'HASLO', null::text, null::text)
) as b (numer, nazwa, sim_phone, password, add_template, remove_template)
where u.email = 'TWOJ_EMAIL@example.com'
on conflict (user_id, numer) do update set
  nazwa = excluded.nazwa, sim_phone = excluded.sim_phone, password = excluded.password,
  add_template = excluded.add_template, remove_template = excluded.remove_template;

-- Sprawdzenie (hasło ukryte):
select numer, nazwa, sim_phone, length(password) as dlugosc_hasla, add_template, remove_template, first_slot
from public.gates order by numer;
