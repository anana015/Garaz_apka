-- 006 (wersja 0.9.0). Uruchomić RAZ w Supabase → SQL Editor po 005.
-- 1) Wszystkie najmy płatne 20. dnia miesiąca – bez względu na datę podpisania/startu umowy (decyzja 11.11).
-- 2) Domyślny dzień płatności nowych najmów w ustawieniach (20).
-- 3) Wypowiedzenie najmu: data złożenia i data końca (zadanie na liście „Zadania”).
-- 4) Wpłata przypisana ręcznie do jednostki (najmu): payments.rental_id – rozlicza najpierw ten najem.
-- Kolumny dodają się tylko raz (if not exists); punkt 1 przy ponownym uruchomieniu znów ustawi 20 wszystkim.

alter table public.settings
  add column if not exists default_billing_day smallint not null default 20
  check (default_billing_day between 1 and 31);

alter table public.rentals add column if not exists notice_given_on date;   -- kiedy złożono wypowiedzenie
alter table public.rentals add column if not exists notice_end_on date;     -- do kiedy trwa najem po wypowiedzeniu

alter table public.payments add column if not exists rental_id uuid references public.rentals (id) on delete set null;

update public.rentals set billing_day = 20 where billing_day <> 20;
