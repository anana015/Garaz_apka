-- 015 (wersja 0.21.0). Uruchomić w Supabase → SQL Editor po 014 (ponowne uruchomienie nic nie psuje).
-- Dane wynajmującego do umów (prośba z 12.11.2026): kilka wersji (np. 3), wybierana przy przygotowaniu umowy,
-- wstawiana w pole {{dane_wynajmujacego}}. Dane wpisuje użytkowniczka w aplikacji (Ustawienia → Wzory umów),
-- nie ma ich w kodzie. Zapis w settings.landlords: [{ id, nazwa, dane }]; null = brak.

alter table public.settings add column if not exists landlords jsonb;

comment on column public.settings.landlords is
  'Dane wynajmującego do umów: [{ id, nazwa (krótka, do wyboru), dane (pełny tekst, kilka linii) }]';
