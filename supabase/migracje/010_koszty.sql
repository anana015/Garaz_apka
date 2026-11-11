-- 010 (wersja 0.15.0) – ETAP 2: koszty i zysk (specyfikacja, rozdz. 15). Uruchomić RAZ po 009 (ponownie – bez szkody).
-- expenses: koszty (data, kategoria, kwota, opcjonalnie jednostka, źródło: import z wyciągu albo ręcznie).
--   category 'pominiety' = wypływ z wyciągu, który nie jest kosztem (zapisany, żeby nie wracał przy kolejnym imporcie).
-- cost_rules: reguły „fraza → kategoria” (opcjonalnie jednostka) do importu wypływów, jak w Budżecie.
-- wczytaj_kopie: kopia zapasowa obejmuje też obie nowe tabele.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  spent_on date not null,
  amount_gr integer not null check (amount_gr > 0),
  category text not null check (category in
    ('prad', 'naprawy', 'podatek_nieruchomosci', 'ubezpieczenie', 'oplaty_bankowe', 'inne', 'pominiety')),
  unit_id uuid references public.units on delete set null,
  source text not null default 'reczne' check (source in ('import', 'reczne')),
  bank_account_id uuid references public.bank_accounts on delete set null,
  counterparty text,
  title text,
  note text,
  dedup_key text,
  import_id uuid references public.imports on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists expenses_dedup on public.expenses (user_id, dedup_key) where dedup_key is not null;
create index if not exists expenses_user_id_idx on public.expenses (user_id);
create index if not exists expenses_unit_id_idx on public.expenses (unit_id);
create index if not exists expenses_import_id_idx on public.expenses (import_id);
create index if not exists expenses_bank_account_id_idx on public.expenses (bank_account_id);

create table if not exists public.cost_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  phrase text not null check (char_length(phrase) between 2 and 80),
  category text not null check (category in
    ('prad', 'naprawy', 'podatek_nieruchomosci', 'ubezpieczenie', 'oplaty_bankowe', 'inne', 'pominiety')),
  unit_id uuid references public.units on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, phrase)
);
create index if not exists cost_rules_unit_id_idx on public.cost_rules (unit_id);

do $$
declare
  t text;
begin
  foreach t in array array['expenses', 'cost_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'own_rows') then
      execute format('create policy own_rows on public.%I for all to authenticated
        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.wczytaj_kopie(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t text;
  n integer;
  wynik jsonb := '{}'::jsonb;
  -- kolejność wstawiania: najpierw tabele, na które wskazują inne (klucze obce)
  kolejnosc constant text[] := array['units', 'clients', 'bank_accounts', 'imports', 'contracts', 'rentals',
    'rental_rates', 'charge_adjustments', 'payments', 'payers', 'deposits', 'client_notes', 'tax_payments', 'settings',
    'expenses', 'cost_rules'];
begin
  if uid is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = '42501';
  end if;

  -- Usuwanie w odwrotnej kolejności (najpierw wiersze wskazujące na inne).
  for i in reverse array_length(kolejnosc, 1) .. 1 loop
    execute format('delete from public.%I where user_id = $1', kolejnosc[i]) using uid;
  end loop;

  foreach t in array kolejnosc loop
    execute format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1)', t)
      using (select coalesce(jsonb_agg(e || jsonb_build_object('user_id', uid)), '[]'::jsonb)
             from jsonb_array_elements(coalesce(p->t, '[]'::jsonb)) e);
    get diagnostics n = row_count;
    wynik := wynik || jsonb_build_object(t, n);
  end loop;

  -- Kopia bez ustawień (np. z pustego konta): wiersz z wartościami domyślnymi.
  insert into public.settings (user_id) values (uid) on conflict (user_id) do nothing;
  return wynik;
end;
$$;

revoke all on function public.wczytaj_kopie(jsonb) from public;
revoke all on function public.wczytaj_kopie(jsonb) from anon;
grant execute on function public.wczytaj_kopie(jsonb) to authenticated;
