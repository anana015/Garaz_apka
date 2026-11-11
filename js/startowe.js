// Import danych startowych z szablonów CSV (7.5). Czyste funkcje – tests/startowe.test.js.
// Wynik to jeden pakiet dla db.zapiszPakiet(): zapisuje się wszystko albo nic.
// Kolejność startu (7.5): jednostki → klienci z saldem otwarcia → najmy i kaucje → wpłaty gotówkowe.
// Każdy błąd ma plik, numer wiersza (jak w Excelu, nagłówek = 1) i powód.

import { naObiekty, parsujCsv } from './csv.js';
import {
  czytajDate, dodajDni, formatData, normalizujTekst, noweId as losoweId, oczyscNip, parseKwota,
} from './utils.js';
import { walidujJednostke, walidujKlienta } from './walidacja.js';

export const SZABLONY = Object.freeze({
  jednostki: {
    plik: 'jednostki.csv', tytul: 'Jednostki',
    kolumny: ['numer', 'typ', 'powierzchnia_m2', 'cena_cennik', 'opis'],
    wymagane: ['numer', 'typ'],
    przyklad: 'G-03; garaż; 18,5; 300; brama od ulicy',
  },
  klienci: {
    plik: 'klienci.csv', tytul: 'Klienci',
    kolumny: ['rodzaj', 'nazwa', 'osoba_kontaktowa', 'nip', 'adres', 'telefon', 'email', 'saldo_otwarcia', 'notatka'],
    wymagane: ['nazwa'],
    przyklad: 'osoba; Jan Nowak; ; ; ul. Polna 1, Kraków; 600100200; jan@example.com; -300; ',
  },
  najmy: {
    plik: 'najmy.csv', tytul: 'Najmy i kaucje',
    kolumny: ['klient', 'jednostka', 'numer_umowy', 'data_podpisania', 'data_startu', 'umowa_do', 'data_konca',
      'dzien_platnosci', 'stawka', 'kaucja', 'forma_kaucji', 'data_kaucji'],
    wymagane: ['klient', 'jednostka', 'data_startu', 'stawka'],
    przyklad: 'Jan Nowak; G-03; U/1/2024; 10.03.2024; 15.03.2024; ; ; 15; 300; 500; gotówka; 10.03.2024',
  },
  wplaty_gotowka: {
    plik: 'wplaty_gotowka.csv', tytul: 'Wpłaty gotówkowe',
    kolumny: ['data', 'klient', 'kwota', 'notatka'],
    wymagane: ['data', 'klient', 'kwota'],
    przyklad: '15.02.2026; Jan Nowak; 300; za luty',
  },
});
export const RODZAJE = Object.freeze(Object.keys(SZABLONY));

const NAJSTARSZA_DATA = '1990-01-01';
// Typ z Excela: klucz („box_duzy”) albo nazwa („Duży box”, „garaż”) – po normalizacji bez ogonków.
const TYPY = {
  KONTENER: 'kontener', GARAZ: 'garaz',
  'BOX DUZY': 'box_duzy', 'DUZY BOX': 'box_duzy', 'BOX MALY': 'box_maly', 'MALY BOX': 'box_maly',
};
const FORMY = { GOTOWKA: 'gotowka', PRZELEW: 'przelew' };
// Kolumny CSV dla pól formularzy – komunikaty walidacji wskazują kolumnę z pliku.
const KOLUMNY_JEDNOSTKI = { code: 'numer', type: 'typ', area_m2: 'powierzchnia_m2', list_price_gr: 'cena_cennik' };
const KOLUMNY_KLIENTA = { name: 'nazwa', nip: 'nip', phone: 'telefon', email: 'email', opening_balance_gr: 'saldo_otwarcia' };

/**
 * Sprawdza pliki i buduje pakiet do zapisu.
 * @param {{ jednostki?: string, klienci?: string, najmy?: string, wplaty_gotowka?: string }} teksty treść plików
 * @param {{ dane: object, ustawienia: object, dzis: string, noweId?: () => string }} kontekst dane – już zapisane w bazie
 * @returns {{ pakiet: object, bledy: Array<{plik, nr, powod}>, liczby: object, wiersze: object }}
 */
export function przygotujImport(teksty, { dane, ustawienia, dzis, noweId = losoweId }) {
  const bledy = [];
  const pakiet = { units: [], clients: [], contracts: [], rentals: [], rental_rates: [], deposits: [], payments: [] };
  const wiersze = {};

  /** Wiersze pliku jako obiekty; brak wymaganej kolumny = błąd całego pliku. */
  const czytaj = (rodzaj) => {
    if (!teksty[rodzaj]) return [];
    const { plik, kolumny, wymagane } = SZABLONY[rodzaj];
    const { wiersze: w, brakujace } = naObiekty(parsujCsv(teksty[rodzaj]), kolumny);
    wiersze[rodzaj] = w.length;
    const brak = brakujace.filter((k) => wymagane.includes(k));
    if (brak.length) {
      bledy.push({ plik, nr: 1, powod: `Brak ${brak.length > 1 ? 'kolumn' : 'kolumny'} ${brak.map((k) => `„${k}”`).join(', ')}. Użyj szablonu.` });
      return [];
    }
    if (!w.length) bledy.push({ plik, nr: 2, powod: 'Plik nie ma wierszy z danymi.' });
    return w;
  };
  const blad = (rodzaj, nr, powod) => bledy.push({ plik: SZABLONY[rodzaj].plik, nr, powod });
  const bledyPol = (rodzaj, nr, bledyFormularza, kolumny) => {
    for (const [pole, komunikat] of Object.entries(bledyFormularza)) blad(rodzaj, nr, `${kolumny[pole] ?? pole}: ${komunikat}`);
  };

  // --- Jednostki ------------------------------------------------------
  const jednostki = [...dane.units];
  for (const { nr, w } of czytaj('jednostki')) {
    const typ = TYPY[normalizujTekst(w.typ)] ?? '';
    const { bledy: b, wiersz } = walidujJednostke({
      code: w.numer, type: typ, area_m2: w.powierzchnia_m2, list_price_gr: w.cena_cennik, description: w.opis,
    }, { jednostki });
    if (!typ && w.typ) b.type = `nieznany typ „${w.typ}” – wpisz garaż, kontener, box_duzy albo box_maly.`;
    if (Object.keys(b).length) {
      bledyPol('jednostki', nr, b, KOLUMNY_JEDNOSTKI);
      continue;
    }
    const jednostka = { id: noweId(), ...wiersz, sort_order: 0 };
    jednostki.push(jednostka);
    pakiet.units.push(jednostka);
  }

  // --- Klienci --------------------------------------------------------
  const klienci = [...dane.clients];
  for (const { nr, w } of czytaj('klienci')) {
    const rodzaj = normalizujTekst(w.rodzaj) === 'FIRMA' ? 'firma' : 'osoba';
    const { bledy: b, wiersz } = walidujKlienta({
      kind: rodzaj, name: w.nazwa, contact_person: w.osoba_kontaktowa, nip: w.nip, address: w.adres,
      phone: w.telefon, email: w.email, opening_balance_gr: w.saldo_otwarcia, note: w.notatka,
    }, { klienci });
    if (w.rodzaj && !['OSOBA', 'FIRMA'].includes(normalizujTekst(w.rodzaj))) b.kind = `nieznany rodzaj „${w.rodzaj}” – wpisz osoba albo firma.`;
    if (!b.name && klienci.some((k) => normalizujTekst(k.name) === normalizujTekst(wiersz.name))) {
      b.name = `klient „${wiersz.name}” już istnieje. Najmy łączą się z klientem po nazwie, więc nazwa musi być jednoznaczna.`;
    }
    if (Object.keys(b).length) {
      bledyPol('klienci', nr, b, { ...KOLUMNY_KLIENTA, kind: 'rodzaj' });
      continue;
    }
    const klient = { id: noweId(), ...wiersz };
    klienci.push(klient);
    pakiet.clients.push(klient);
  }

  /** Klient po NIP albo nazwie – z bazy albo z pliku klienci.csv. */
  const znajdzKlienta = (tekst) => {
    const nip = oczyscNip(tekst);
    const pasujace = /^\d{10}$/.test(nip)
      ? klienci.filter((k) => k.nip === nip)
      : klienci.filter((k) => normalizujTekst(k.name) === normalizujTekst(tekst));
    if (pasujace.length === 1) return { klient: pasujace[0] };
    return { blad: pasujace.length ? `kilku klientów pasuje do „${tekst}” – podaj NIP.` : `nie ma klienta „${tekst}”.` };
  };
  const znajdzJednostke = (tekst) => jednostki.find((j) => j.code.toUpperCase() === tekst.trim().toUpperCase()) ?? null;
  const naDate = (rodzaj, nr, kolumna, tekst, { wymagana = false } = {}) => {
    if (!tekst) {
      if (wymagana) blad(rodzaj, nr, `${kolumna}: brak daty.`);
      return null;
    }
    const d = czytajDate(tekst);
    if (!d) blad(rodzaj, nr, `${kolumna}: „${tekst}” to nie data. Wpisz np. 15.03.2026.`);
    else if (d < NAJSTARSZA_DATA || d > dodajDni(dzis, 366)) blad(rodzaj, nr, `${kolumna}: data spoza zakresu (${formatData(d)}).`);
    return d;
  };

  // --- Najmy, umowy i kaucje -------------------------------------------
  const umowyWBazie = new Map(dane.contracts.filter((u) => u.number && !u.archived)
    .map((u) => [`${u.client_id}|${normalizujTekst(u.number)}`, u]));
  const umowyZPliku = new Map();   // klucz → { umowa, nr, kaucja }
  const najmyJednostek = new Map();   // unit_id → [{ start, koniec, nr? }]
  for (const n of dane.rentals) {
    if (!najmyJednostek.has(n.unit_id)) najmyJednostek.set(n.unit_id, []);
    najmyJednostek.get(n.unit_id).push({ start: n.start_on, koniec: n.end_on, nr: null });
  }

  for (const { nr, w } of czytaj('najmy')) {
    const przed = bledy.length;
    const { klient, blad: bladKlienta } = w.klient ? znajdzKlienta(w.klient) : { blad: 'brak klienta.' };
    if (bladKlienta) blad('najmy', nr, `klient: ${bladKlienta}`);
    const jednostka = w.jednostka ? znajdzJednostke(w.jednostka) : null;
    if (!jednostka) blad('najmy', nr, w.jednostka ? `jednostka: nie ma jednostki „${w.jednostka}”.` : 'jednostka: brak numeru.');
    const start = naDate('najmy', nr, 'data_startu', w.data_startu, { wymagana: true });
    const podpisana = naDate('najmy', nr, 'data_podpisania', w.data_podpisania);
    const umowaDo = naDate('najmy', nr, 'umowa_do', w.umowa_do);
    const koniec = naDate('najmy', nr, 'data_konca', w.data_konca);
    if (start && koniec && koniec < start) blad('najmy', nr, 'data_konca: wcześniejsza niż data_startu.');
    if (start && umowaDo && umowaDo < start) blad('najmy', nr, 'umowa_do: wcześniejsza niż data_startu.');

    const stawka = parseKwota(w.stawka);
    if (stawka == null || stawka <= 0) blad('najmy', nr, `stawka: „${w.stawka}” – podaj kwotę większą od zera.`);
    const dzien = w.dzien_platnosci ? Number(w.dzien_platnosci) : (ustawienia.default_billing_day ?? 20);
    if (!Number.isInteger(dzien) || dzien < 1 || dzien > 31) blad('najmy', nr, 'dzien_platnosci: liczba od 1 do 31.');

    const kaucja = w.kaucja ? parseKwota(w.kaucja) : null;
    if (w.kaucja && (kaucja == null || kaucja <= 0)) blad('najmy', nr, `kaucja: „${w.kaucja}” – podaj kwotę albo zostaw puste.`);
    const forma = w.forma_kaucji ? FORMY[normalizujTekst(w.forma_kaucji)] : 'gotowka';
    if (!forma) blad('najmy', nr, `forma_kaucji: „${w.forma_kaucji}” – wpisz gotówka albo przelew.`);
    const dataKaucji = naDate('najmy', nr, 'data_kaucji', w.data_kaucji);

    // Nakładające się najmy tej samej jednostki (test 16) – z bazą i z poprawnymi wierszami pliku.
    if (jednostka && start && !(koniec && koniec < start)) {
      const kolizja = (najmyJednostek.get(jednostka.id) ?? [])
        .find((x) => x.start <= (koniec ?? '9999-12-31') && start <= (x.koniec ?? '9999-12-31'));
      if (kolizja) {
        blad('najmy', nr, kolizja.nr
          ? `jednostka ${jednostka.code}: najem nakłada się z wierszem ${kolizja.nr}.`
          : `jednostka ${jednostka.code}: w bazie jest już najem od ${formatData(kolizja.start)}${kolizja.koniec ? ` do ${formatData(kolizja.koniec)}` : ''}.`);
      }
    }
    if (bledy.length > przed) continue;
    if (!najmyJednostek.has(jednostka.id)) najmyJednostek.set(jednostka.id, []);
    najmyJednostek.get(jednostka.id).push({ start, koniec, nr });

    // Umowa: ten sam klient i numer = jedna umowa z kilkoma jednostkami (także umowa już zapisana w bazie).
    const numer = w.numer_umowy || null;
    const klucz = numer ? `${klient.id}|${normalizujTekst(numer)}` : `wiersz-${nr}`;
    let grupa = umowyZPliku.get(klucz);
    if (!grupa) {
      const wBazie = umowyWBazie.get(klucz);
      const umowa = wBazie ?? {
        id: noweId(), client_id: klient.id, number: numer, signed_on: podpisana, valid_until: umowaDo,
      };
      grupa = { umowa, nr, kaucja: null, wBazie: Boolean(wBazie) };
      umowyZPliku.set(klucz, grupa);
      if (!wBazie) pakiet.contracts.push(umowa);
    }

    if (kaucja) {
      if (grupa.kaucja && grupa.kaucja.kwota !== kaucja) {
        blad('najmy', nr, `kaucja: inna niż w wierszu ${grupa.kaucja.nr} tej samej umowy (${numer}). Kaucja jest jedna na umowę.`);
      } else if (grupa.wBazie && dane.deposits.some((d) => d.contract_id === grupa.umowa.id)) {
        blad('najmy', nr, `kaucja: umowa ${numer} ma już kaucję w bazie.`);
      } else if (!grupa.kaucja) {
        grupa.kaucja = { kwota: kaucja, nr };
        pakiet.deposits.push({
          contract_id: grupa.umowa.id, kind: 'przyjecie', amount_gr: kaucja, method: forma,
          on_date: dataKaucji ?? podpisana ?? start,
        });
      }
    }

    const najemId = noweId();
    pakiet.rentals.push({
      id: najemId, contract_id: grupa.umowa.id, unit_id: jednostka.id, start_on: start, end_on: koniec,
      billing_day: dzien, period_months: 1, last_period: ustawienia.default_last_period,
    });
    pakiet.rental_rates.push({ rental_id: najemId, valid_from: start, amount_gr: stawka, reason: 'start' });
  }

  // --- Wpłaty gotówkowe -------------------------------------------------
  for (const { nr, w } of czytaj('wplaty_gotowka')) {
    const przed = bledy.length;
    const data = naDate('wplaty_gotowka', nr, 'data', w.data, { wymagana: true });
    if (data && (data < ustawienia.data_start || data > dzis)) {
      blad('wplaty_gotowka', nr, `data: wpłata musi być od ${formatData(ustawienia.data_start)} do dziś.`);
    }
    const { klient, blad: bladKlienta } = w.klient ? znajdzKlienta(w.klient) : { blad: 'brak klienta.' };
    if (bladKlienta) blad('wplaty_gotowka', nr, `klient: ${bladKlienta}`);
    const kwota = parseKwota(w.kwota);
    if (kwota == null || kwota <= 0) blad('wplaty_gotowka', nr, `kwota: „${w.kwota}” – podaj kwotę większą od zera.`);
    if (bledy.length > przed) continue;
    const powtorka = (p) => p.method === 'gotowka' && p.client_id === klient.id && p.booked_on === data && p.amount_gr === kwota;
    if (dane.payments.some(powtorka)) {
      blad('wplaty_gotowka', nr, 'taka wpłata gotówką (data, klient, kwota) jest już w bazie.');
      continue;
    }
    pakiet.payments.push({
      booked_on: data, amount_gr: kwota, kind: 'czynsz', method: 'gotowka', client_id: klient.id,
      match_method: 'reczne', match_confirmed: true, note: w.notatka || null,
    });
  }

  const liczby = Object.fromEntries(Object.entries(pakiet).map(([t, lista]) => [t, lista.length]));
  return { pakiet, bledy, liczby, wiersze };
}
