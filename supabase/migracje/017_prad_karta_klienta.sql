-- 017 (wersja 0.23.0). Uruchomić w Supabase → SQL Editor po 016 (ponowne uruchomienie nic nie psuje).
-- Prośby z 12.11.2026:
--  1. Polecenia sterowników bram z prefiksem 4800: {haslo}#TEL4800{telefon9}#{pozycja}# i {haslo}#DEL4800{telefon9}#{pozycja}#
--     (np. 1234#TEL4800600111222#205#).
--  2. Rozliczanie prądu co kwartał: power_readings – odczyty liczników jednostek z prądem; odczyt kwartalny dolicza
--     do należności klienta kwotę (zużycie × cena) jako wiersz charge_adjustments (adjustment_id).
--     settings.power_price_gr – cena 1 kWh w groszach (domyślnie 130 = 1,30 zł brutto).
--  3. Własny układ karty klienta: settings.client_card_layout – [{ id, szeroka, widoczna }] w kolejności; null = domyślny.
--  wczytaj_kopie – z tabelą power_readings (kopie sprzed tej wersji wczytują się bez zmian).

update public.gates set
  add_template = '{haslo}#TEL4800{telefon9}#{pozycja}#',
  remove_template = '{haslo}#DEL4800{telefon9}#{pozycja}#';

alter table public.settings add column if not exists power_price_gr integer default 130;
alter table public.settings add column if not exists client_card_layout jsonb;

create table if not exists public.power_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  unit_id uuid not null references public.units on delete cascade,
  rental_id uuid references public.rentals on delete set null,     -- najem, którego dotyczy (null – jednostka wolna)
  read_on date not null,
  kwh numeric(12,1) not null check (kwh >= 0),                     -- stan licznika
  amount_gr integer,                                                -- doliczona kwota (null – odczyt początkowy)
  adjustment_id uuid references public.charge_adjustments on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists power_readings_jednostka on public.power_readings (unit_id, read_on);
create index if not exists power_readings_user on public.power_readings (user_id);

alter table public.power_readings enable row level security;
drop policy if exists own_rows on public.power_readings;
create policy own_rows on public.power_readings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.power_readings from anon;
grant select, insert, update, delete on public.power_readings to authenticated;

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
    'expenses', 'cost_rules', 'gates', 'gate_access', 'power_readings'];
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
