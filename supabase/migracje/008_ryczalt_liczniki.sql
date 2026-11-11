-- 008 (wersja 0.12.0). Uruchomić RAZ w Supabase → SQL Editor po 007 (ponowne uruchomienie nic nie psuje).
-- Osobne liczniki ryczałtu (prośba 11.11.2026): konto Millennium, pozostałe konta, gotówka –
-- każdy z własnym ryczałtem kwartalnym i własnymi wpłatami podatku.
-- Wpłaty zapisane wcześniej trafiają do „pozostałych kont” – w razie potrzeby popraw je w Raportach.
-- Kolumna dopuszcza null (= pozostałe konta), żeby kopie zapasowe sprzed tej wersji wczytywały się bez zmian.

alter table public.tax_payments add column if not exists grupa text
  check (grupa in ('millennium', 'pozostale', 'gotowka'));
update public.tax_payments set grupa = 'pozostale' where grupa is null;

alter table public.tax_payments drop constraint if exists tax_payments_user_id_year_quarter_key;
create unique index if not exists tax_payments_rok_kwartal_grupa
  on public.tax_payments (user_id, year, quarter, (coalesce(grupa, 'pozostale')));
