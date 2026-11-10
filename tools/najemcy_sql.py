#!/usr/bin/env python3
"""Import aktualnych najemców: Excel (najemcy_szablon.xlsx) → skrypt SQL dla Supabase.

Użycie:  python3 tools/najemcy_sql.py najemcy.xlsx [najemcy.sql]

Jeden wiersz arkusza „Najemcy” = jeden najem (jednostka). Klient z kilkoma jednostkami = kilka wierszy
z tym samym imieniem i nazwiskiem. Skrypt najpierw sprawdza plik (błędy z numerem wiersza jak w Excelu),
a wygenerowany SQL sprawdza bazę i zapisuje wszystko albo nic (jeden blok DO).

Zasady (decyzje z 10.11.2026):
- stawka z umowy obowiązuje od daty wynajęcia; gdy obecna cena jednostki (units.list_price_gr) jest
  wyższa, od 01.02.2026 obowiązuje obecna cena (rental_rates, powód „podwyżka”),
- miejsce płatności zapisuje się przy najmie: rentals.pay_method + rentals.bank_account_id (migracja 002),
- dzień płatności = dzień miesiąca z daty wynajęcia (Z4), okres 1 miesiąc, umowa na czas nieokreślony.
"""
from __future__ import annotations

import datetime as dt
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

DATA_PODWYZKI = '2026-02-01'
ARKUSZ = 'Najemcy'
KOLUMNY = {   # nagłówek w Excelu → klucz
    'jednostka': 'jednostka', 'imie i nazwisko': 'nazwa', 'data wynajecia': 'start',
    'stawka z umowy zl': 'stawka', 'gdzie placi': 'gdzie', 'telefon': 'telefon', 'e mail': 'email', 'email': 'email',
}
WYMAGANE = ['jednostka', 'nazwa', 'start', 'stawka', 'gdzie']
# Miejsce płatności → (pay_method, bank)
GDZIE = {
    'NEST': ('przelew', 'nest'), 'NEST BANK': ('przelew', 'nest'),
    'PKO': ('przelew', 'pko'), 'PKO BP': ('przelew', 'pko'),
    'ALIOR': ('przelew', 'alior'), 'ALIOR BANK': ('przelew', 'alior'),
    'MILLENNIUM': ('przelew', 'millennium'), 'MILLENIUM': ('przelew', 'millennium'), 'BANK MILLENNIUM': ('przelew', 'millennium'),
    'GOTOWKA': ('gotowka', None),
    'FV': ('fv', None),
}
NAZWY_KONT = {'nest': 'Nest Bank – najem', 'pko': 'PKO BP – najem', 'alior': 'Alior – najem', 'millennium': 'Millennium – najem'}


def normalizuj(tekst) -> str:
    """Jak normalizujTekst() w js/utils.js: wielkie litery, bez ogonków, same litery i cyfry."""
    t = str(tekst or '').replace('ł', 'l').replace('Ł', 'L')
    t = unicodedata.normalize('NFD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c)).upper()
    return re.sub(r'[^A-Z0-9]+', ' ', t).strip()


def tekst(w) -> str:
    if w is None:
        return ''
    if isinstance(w, float) and w.is_integer():
        w = int(w)
    return re.sub(r'\s+', ' ', str(w)).strip()


def czytaj_date(w):
    if isinstance(w, dt.datetime):
        return w.date()
    if isinstance(w, dt.date):
        return w
    t = tekst(w)
    for wzor in ('%d.%m.%Y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%d.%m.%y'):
        try:
            return dt.datetime.strptime(t, wzor).date()
        except ValueError:
            pass
    return None


def czytaj_kwote_gr(w):
    """Kwota w złotych → grosze (int). Przyjmuje liczbę z Excela albo tekst „1 234,56 zł”."""
    if isinstance(w, (int, float)):
        return round(w * 100)
    t = tekst(w).lower().replace('zł', '').replace('zl', '').replace(' ', '').replace(' ', '')
    if re.fullmatch(r'\d+([.,]\d{1,2})?', t):
        return round(float(t.replace(',', '.')) * 100)
    return None


def klucz_kontaktu(pole: str, wart: str) -> str:
    """Do porównania: telefon = ostatnie 9 cyfr (bez +48 i spacji), e-mail bez zmian."""
    return re.sub(r'\D', '', wart)[-9:] if pole == 'telefon' else wart


def sql_tekst(w) -> str:
    return 'null' if w in (None, '') else "'" + str(w).replace("'", "''") + "'"


def wczytaj(sciezka: Path, dzis: dt.date):
    wb = openpyxl.load_workbook(sciezka, data_only=True)
    ws = wb[ARKUSZ] if ARKUSZ in wb.sheetnames else wb.worksheets[0]
    wiersze = list(ws.iter_rows(values_only=True))
    # Wiersz nagłówka: pierwszy, w którym jest kolumna „jednostka”.
    nr_nagl = next((i for i, w in enumerate(wiersze) if any(normalizuj(k).lower() == 'jednostka' for k in w)), None)
    if nr_nagl is None:
        return [], ['Nie znalazłem wiersza nagłówka z kolumną „Jednostka”. Użyj szablonu.']
    naglowki = [KOLUMNY.get(normalizuj(k).lower()) for k in wiersze[nr_nagl]]
    brak = [k for k in WYMAGANE if k not in naglowki]
    if brak:
        return [], [f'Brak kolumn: {", ".join(brak)}. Użyj szablonu.']

    bledy, dane, jednostki, klienci = [], [], {}, {}
    for i, w in enumerate(wiersze[nr_nagl + 1:], start=nr_nagl + 2):
        r = {k: w[j] for j, k in enumerate(naglowki) if k and j < len(w)}
        if all(tekst(v) == '' for v in r.values()):
            continue
        blad = lambda powod: bledy.append(f'wiersz {i}: {powod}')
        przed = len(bledy)

        kod = tekst(r.get('jednostka')).upper()
        if not kod:
            blad('brak jednostki.')
        elif kod in jednostki:
            blad(f'jednostka {kod} jest już w wierszu {jednostki[kod]}.')
        else:
            jednostki[kod] = i

        nazwa = tekst(r.get('nazwa'))
        if not nazwa:
            blad('brak imienia i nazwiska.')
        elif len(nazwa) > 80:
            blad('imię i nazwisko dłuższe niż 80 znaków.')

        start = czytaj_date(r.get('start'))
        if not start:
            blad(f'data wynajęcia „{tekst(r.get("start"))}” to nie data – wpisz np. 15.03.2024.')
        elif not (dt.date(1990, 1, 1) <= start <= dzis):
            blad(f'data wynajęcia {start:%d.%m.%Y} spoza zakresu (od 1990 do dziś).')

        stawka = czytaj_kwote_gr(r.get('stawka'))
        if not stawka or stawka <= 0:
            blad(f'stawka „{tekst(r.get("stawka"))}” – podaj kwotę większą od zera.')

        gdzie = GDZIE.get(normalizuj(r.get('gdzie')))
        if not gdzie:
            blad(f'gdzie płaci „{tekst(r.get("gdzie"))}” – wybierz: Nest Bank, PKO BP, Alior, Millennium, gotówka albo FV.')

        telefon = tekst(r.get('telefon'))
        if telefon and not re.fullmatch(r'(\+48)?\d{9}', re.sub(r'[\s-]', '', telefon)):
            blad(f'telefon „{telefon}” – 9 cyfr albo z prefiksem +48.')
            telefon = ''
        email = tekst(r.get('email')).lower()
        if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}', email):
            blad(f'e-mail „{email}” ma zły format.')
            email = ''

        # Ten sam klient w kilku wierszach: telefon i e-mail nie mogą się różnić.
        if nazwa:
            klucz = normalizuj(nazwa)
            k = klienci.setdefault(klucz, {'nazwa': nazwa, 'telefon': '', 'email': '', 'nr': i})
            for pole, wart in (('telefon', telefon), ('email', email)):
                if wart and k[pole] and klucz_kontaktu(pole, k[pole]) != klucz_kontaktu(pole, wart):
                    blad(f'{pole} „{wart}” inny niż w wierszu {k["nr"]} tego samego klienta („{k[pole]}”).')
                elif wart:
                    k[pole] = wart
            nazwa = k['nazwa']   # jedna pisownia dla wszystkich wierszy klienta

        if len(bledy) == przed:
            dane.append({'nr': i, 'jednostka': kod, 'nazwa': nazwa, 'start': start, 'stawka_gr': stawka,
                         'metoda': gdzie[0], 'bank': gdzie[1]})
    for d in dane:   # telefon i e-mail z dowolnego wiersza klienta
        k = klienci[normalizuj(d['nazwa'])]
        d['telefon'], d['email'] = k['telefon'], k['email']
    if not dane and not bledy:
        bledy.append('Arkusz nie ma wierszy z danymi.')
    return dane, bledy


def generuj_sql(dane, zrodlo: str, dzis: dt.date) -> str:
    wartosci = ',\n'.join(
        f"  ({d['nr']}, {sql_tekst(d['jednostka'])}, {sql_tekst(d['nazwa'])}, '{d['start']:%Y-%m-%d}', {d['stawka_gr']}, "
        f"{sql_tekst(d['metoda'])}, {sql_tekst(d['bank'])}, {sql_tekst(d['telefon'])}, {sql_tekst(d['email'])})"
        for d in dane)
    nazwy_kont = '\n'.join(f"      when '{b}' then '{n}'" for b, n in NAZWY_KONT.items())
    return f"""-- Import aktualnych najemców ({len(dane)} najmów) – wygenerowano {dzis:%d.%m.%Y} z pliku {zrodlo}
-- przez tools/najemcy_sql.py. Wymaga migracji 002_miejsce_platnosci.sql.
-- Supabase → SQL Editor: wklej całość i uruchom. Zapisuje wszystko albo nic. Ponowne uruchomienie
-- zatrzyma się na błędzie „mają już najem” i niczego nie zdubluje.

drop table if exists imp_najemcy, imp_wynik;
create temp table imp_najemcy (
  nr int, jednostka text, nazwa text, start_on date, stawka_gr int, metoda text, bank text, telefon text, email text);
create temp table imp_wynik (rental_id uuid, uwaga text);

insert into imp_najemcy values
{wartosci};

do $$
declare
  uid uuid;
  n int;
  lista text;
  r record;
  v_klient uuid;
  v_umowa uuid;
  v_najem uuid;
  v_konto uuid;
  v_ostatni text;
  v_uwaga text;
begin
  -- Właściciel danych: jedyny użytkownik, którego jednostki są w bazie (aplikacja ma jednego użytkownika).
  select count(distinct user_id) into n from units;
  if n <> 1 then
    raise exception 'W tabeli units jest % użytkowników – oczekiwano jednego. Najpierw wczytaj jednostki.', n;
  end if;
  select user_id into uid from units limit 1;

  select string_agg(i.jednostka || ' (wiersz ' || i.nr || ')', ', ' order by i.nr) into lista
  from imp_najemcy i
  where not exists (select 1 from units u where u.user_id = uid and upper(u.code) = upper(i.jednostka));
  if lista is not null then
    raise exception 'Nie ma w bazie jednostek: %. Sprawdź numery na ekranie Jednostki.', lista;
  end if;

  select string_agg(distinct i.jednostka || ' (najem od ' || to_char(n_.start_on, 'DD.MM.YYYY') || ')', ', ') into lista
  from imp_najemcy i
  join units u on u.user_id = uid and upper(u.code) = upper(i.jednostka)
  join rentals n_ on n_.unit_id = u.id
  where daterange(n_.start_on, n_.end_on, '[]') && daterange(i.start_on, null, '[]');
  if lista is not null then
    raise exception 'Te jednostki mają już najem w bazie (import był już uruchomiony?): %', lista;
  end if;

  select string_agg(distinct i.nazwa, ', ') into lista
  from imp_najemcy i
  where (select count(*) from clients c where c.user_id = uid and not c.archived
         and lower(trim(c.name)) = lower(i.nazwa)) > 1;
  if lista is not null then
    raise exception 'Kilku klientów w bazie ma tę samą nazwę: % – popraw nazwy w aplikacji.', lista;
  end if;

  -- Konta bankowe: istniejące konto danego banku albo nowe (numer rachunku można dopisać w Ustawieniach).
  create temp table if not exists imp_konta (bank text primary key, id uuid not null);
  truncate imp_konta;
  for r in select distinct bank from imp_najemcy where bank is not null loop
    select count(*) into n from bank_accounts where user_id = uid and bank = r.bank and not archived;
    if n > 1 then
      raise exception 'Jest kilka aktywnych kont banku % – zarchiwizuj zbędne albo przypisz konta ręcznie.', r.bank;
    elsif n = 1 then
      select id into v_konto from bank_accounts where user_id = uid and bank = r.bank and not archived;
    else
      insert into bank_accounts (user_id, name, bank)
      values (uid, case r.bank
{nazwy_kont}
      end, r.bank)
      returning id into v_konto;
    end if;
    insert into imp_konta values (r.bank, v_konto);
  end loop;

  select coalesce(max(default_last_period), 'proporcjonalnie') into v_ostatni from settings where user_id = uid;

  for r in
    select i.*, u.id as unit_id, u.list_price_gr, u.out_of_service, u.archived as unit_archived
    from imp_najemcy i join units u on u.user_id = uid and upper(u.code) = upper(i.jednostka)
    order by i.nr
  loop
    -- Klient: istniejący o tej samej nazwie (uzupełniamy brakujący telefon i e-mail) albo nowy.
    select id into v_klient from clients
    where user_id = uid and not archived and lower(trim(name)) = lower(r.nazwa);
    if v_klient is null then
      insert into clients (user_id, kind, name, phone, email)
      values (uid, 'osoba', r.nazwa, r.telefon, r.email)
      returning id into v_klient;
    else
      update clients set phone = coalesce(phone, r.telefon), email = coalesce(email, r.email) where id = v_klient;
    end if;

    -- Umowa bez numeru i PDF, na czas nieokreślony – do uzupełnienia na karcie klienta.
    insert into contracts (user_id, client_id) values (uid, v_klient) returning id into v_umowa;

    insert into rentals (user_id, contract_id, unit_id, start_on, billing_day, period_months, last_period,
                         pay_method, bank_account_id)
    values (uid, v_umowa, r.unit_id, r.start_on, extract(day from r.start_on)::smallint, 1, v_ostatni,
            r.metoda, (select id from imp_konta k where k.bank = r.bank))
    returning id into v_najem;

    insert into rental_rates (user_id, rental_id, valid_from, amount_gr, reason)
    values (uid, v_najem, r.start_on, r.stawka_gr, 'start');

    v_uwaga := null;
    if r.list_price_gr is null then
      v_uwaga := 'jednostka bez ceny w cenniku – zostaje stawka z umowy';
    elsif r.list_price_gr > r.stawka_gr and r.start_on < date '{DATA_PODWYZKI}' then
      insert into rental_rates (user_id, rental_id, valid_from, amount_gr, reason)
      values (uid, v_najem, date '{DATA_PODWYZKI}', r.list_price_gr, 'podwyżka');
      v_uwaga := 'podwyżka od 01.02.2026';
    elsif r.list_price_gr > r.stawka_gr then
      v_uwaga := 'SPRAWDŹ: obecna cena wyższa niż stawka z umowy, ale najem zaczął się po 01.02.2026 – bez podwyżki';
    elsif r.list_price_gr < r.stawka_gr then
      v_uwaga := 'SPRAWDŹ: obecna cena niższa niż stawka z umowy – zostaje stawka z umowy';
    end if;
    if r.out_of_service or r.unit_archived then
      v_uwaga := concat_ws('; ', v_uwaga, 'SPRAWDŹ: jednostka wyłączona z najmu albo zarchiwizowana');
    end if;
    insert into imp_wynik values (v_najem, v_uwaga);
  end loop;
end $$;

-- Wynik do sprawdzenia: każdy zaimportowany najem z obecną stawką i miejscem płatności.
select u.code as jednostka, c.name as klient, to_char(r.start_on, 'DD.MM.YYYY') as od,
       r.billing_day as dzien_platnosci,
       ((select amount_gr from rental_rates x where x.rental_id = r.id order by valid_from limit 1) / 100.0)::numeric(10,2) as stawka_z_umowy,
       ((select amount_gr from rental_rates x where x.rental_id = r.id order by valid_from desc limit 1) / 100.0)::numeric(10,2) as stawka_obecna,
       case r.pay_method when 'gotowka' then 'gotówka' when 'fv' then 'FV' else coalesce(b.name, 'przelew') end as gdzie_placi,
       c.phone as telefon, c.email, w.uwaga
from imp_wynik w
join rentals r on r.id = w.rental_id
join units u on u.id = r.unit_id
join contracts k on k.id = r.contract_id
join clients c on c.id = k.client_id
left join bank_accounts b on b.id = r.bank_account_id
order by w.uwaga is null, c.name, u.code;
"""


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    wej = Path(argv[1])
    wyj = Path(argv[2]) if len(argv) > 2 else wej.with_suffix('.sql')
    dzis = dt.date.today()
    dane, bledy = wczytaj(wej, dzis)
    if bledy:
        print(f'Plik ma błędy ({len(bledy)}) – SQL nie powstał:')
        for b in bledy:
            print(' -', b)
        return 1
    wyj.write_text(generuj_sql(dane, wej.name, dzis), encoding='utf-8')
    klienci = len({normalizuj(d['nazwa']) for d in dane})
    print(f'OK: {len(dane)} najmów, {klienci} klientów → {wyj}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
