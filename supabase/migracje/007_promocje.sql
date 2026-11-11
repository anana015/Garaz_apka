-- 007 (wersja 0.10.0). Uruchomić RAZ w Supabase → SQL Editor po 006 (ponowne uruchomienie nic nie psuje).
-- Lista promocji do wyboru w nowym najmie i w formularzu promocji (prośba z 11.11.2026).
-- null = lista domyślna z aplikacji (js/promocje.js): „Promocja startowa −50% / 2 mies.”, „Zniżka na pierwszy miesiąc”.
-- Kolumna dopuszcza null, więc kopie zapasowe sprzed tej wersji wczytują się bez zmian (wczytaj_kopie).

alter table public.settings add column if not exists promotions jsonb;

comment on column public.settings.promotions is
  'Lista promocji: [{ id, nazwa, rabat (%), okresy }]; null = lista domyślna aplikacji';
