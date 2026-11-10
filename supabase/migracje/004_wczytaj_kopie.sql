-- 004 (wersja 0.7.0): wczytanie kopii zapasowej JSON (rozdz. 10) – zastępuje WSZYSTKIE dane użytkownika
-- w jednej transakcji: albo cała kopia, albo nic. Uruchomić w Supabase → SQL Editor po 003.
-- Można uruchomić ponownie bez szkody (create or replace).
--
-- p = { units: [...], clients: [...], …, settings: [ {…} ] } – tabele jak w pliku kopii (pole tables).
-- Wiersze zachowują swoje id, a user_id jest zawsze nadpisywany zalogowanym użytkownikiem,
-- więc kopię można wczytać także na nowe, puste konto (test akceptacyjny 18).
-- security invoker: działa z prawami zalogowanego użytkownika, obowiązuje RLS.
-- Pliki PDF umów nie są w kopii JSON – zostają w Storage (ścieżki w contracts.pdf_path).

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
    'rental_rates', 'charge_adjustments', 'payments', 'payers', 'deposits', 'client_notes', 'tax_payments', 'settings'];
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
