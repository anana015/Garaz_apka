-- 005 (wersja 0.8.0): ręczne mapowanie kolumn wyciągu CSV zapamiętane przy koncie (7.2).
-- Dla banków bez gotowego profilu (np. PKO BP, Alior): po pierwszym wskazaniu kolumn kolejne wyciągi
-- z tymi samymi nagłówkami wczytują się same. Można uruchomić ponownie bez szkody.

alter table public.bank_accounts add column if not exists csv_mapping jsonb;

comment on column public.bank_accounts.csv_mapping is
  'Ręczne mapowanie kolumn CSV: { podpis: nagłówki pliku, kolumny: { data, kwota, kontrahent, tytul, rachunek, waluta } }';
