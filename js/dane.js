// Indeksy i proste zapytania na pobranych danych. Czyste funkcje (tests/dane.test.js).
// Daty to tekst RRRR-MM-DD, więc porównanie tekstowe = porównanie dat.

const wgId = (tablica) => new Map(tablica.map((x) => [x.id, x]));

function grupuj(tablica, klucz) {
  const mapa = new Map();
  for (const x of tablica) {
    const k = x[klucz];
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(x);
  }
  return mapa;
}

/**
 * Buduje mapy do szybkiego wyszukiwania (raz po pobraniu danych zamiast filtrowania w każdym widoku).
 * @returns {{ jednostki: Map, klienci: Map, umowy: Map, konta: Map, najmyJednostki: Map, najmyKlienta: Map, stawkiNajmu: Map }}
 */
export function zbudujIndeksy(dane) {
  const umowy = wgId(dane.contracts);
  const najmyKlienta = new Map();
  for (const najem of dane.rentals) {
    const umowa = umowy.get(najem.contract_id);
    if (!umowa) continue;
    if (!najmyKlienta.has(umowa.client_id)) najmyKlienta.set(umowa.client_id, []);
    najmyKlienta.get(umowa.client_id).push(najem);
  }
  return {
    jednostki: wgId(dane.units),
    klienci: wgId(dane.clients),
    umowy,
    konta: wgId(dane.bank_accounts),
    najmyJednostki: grupuj(dane.rentals, 'unit_id'),
    najmyKlienta,
    stawkiNajmu: grupuj(dane.rental_rates, 'rental_id'),
  };
}

/**
 * Dopisuje albo podmienia (po id) zapisane wiersze, zamiast pobierać wszystkie tabele od nowa.
 * zmiany: { units: [...], rentals: [...] } – układ wyniku zapisz_pakiet(); settings jako obiekt.
 * Zwraca nowy obiekt danych (stare tablice zostają nietknięte).
 */
export function scalDane(dane, zmiany) {
  const wynik = { ...dane };
  for (const [tabela, wiersze] of Object.entries(zmiany)) {
    if (tabela === 'settings') {
      wynik.settings = wiersze;
      continue;
    }
    if (!Array.isArray(dane[tabela]) || !wiersze?.length) continue;
    const nowe = new Map(wiersze.map((w) => [w.id, w]));
    const lista = dane[tabela].map((w) => nowe.get(w.id) ?? w);
    const byly = new Set(dane[tabela].map((w) => w.id));
    for (const w of wiersze) if (!byly.has(w.id)) lista.push(w);
    wynik[tabela] = lista;
  }
  return wynik;
}

/** Najem trwa w dniu D: start ≤ D i brak końca albo koniec ≥ D (5.8). */
export const najemTrwa = (najem, dzien) =>
  najem.start_on <= dzien && (najem.end_on == null || najem.end_on >= dzien);

/** Najem jest zakończony przed dniem D. */
export const najemZakonczony = (najem, dzien) => najem.end_on != null && najem.end_on < dzien;

/** Najem trwający w dniu D albo null. Baza gwarantuje najwyżej jeden na jednostkę. */
export function biezacyNajem(najmy = [], dzien) {
  return najmy.find((n) => najemTrwa(n, dzien)) ?? null;
}

/**
 * Planowany koniec trwającego najmu (prośba 11.11): data końca z wypowiedzenia albo przyszła data końca
 * (np. jednostka przejęta przez nowego najemcę). null – najem bez końca albo już zakończony.
 */
export function planowanyKoniec(najem, dzien) {
  if (!najem || najemZakonczony(najem, dzien)) return null;
  return najem.notice_end_on ?? najem.end_on ?? null;
}

/** Stawka miesięczna (grosze) o największym valid_from nie późniejszym niż dzień (5.1); null, gdy brak. */
export function stawkaNaDzien(stawki = [], dzien) {
  let wynik = null;
  for (const s of stawki) {
    if (s.valid_from <= dzien && (!wynik || s.valid_from > wynik.valid_from)) wynik = s;
  }
  return wynik?.amount_gr ?? null;
}

/** Wpłaty czynszowe bez klienta – „Do przypisania” (4. Zasady zapisu). */
export const doPrzypisania = (wplaty) => wplaty.filter((w) => w.kind === 'czynsz' && !w.client_id);

/**
 * Liczba pełnych miesięcy kalendarzowych z wpłatami: od miesiąca najstarszej wpłaty
 * do miesiąca przed bieżącym (12.3: Raporty pojawiają się po 2 pełnych miesiącach).
 * Miesiąc najstarszej wpłaty liczy się jako pełny, bo wyciągi obejmują cały miesiąc (Z33).
 */
export function pelneMiesiaceWplat(wplaty, dzien) {
  let najstarsza = null;
  for (const w of wplaty) if (!najstarsza || w.booked_on < najstarsza) najstarsza = w.booked_on;
  if (!najstarsza) return 0;
  const indeks = (data) => Number(data.slice(0, 4)) * 12 + Number(data.slice(5, 7));
  return Math.max(0, indeks(dzien) - indeks(najstarsza));
}

/** Data ostatniej wpłaty na każdym koncie (8.3: od kiedy pobrać kolejny wyciąg). */
export function ostatniaWplataNaKoncie(wplaty) {
  const wynik = new Map();
  for (const w of wplaty) {
    if (!w.bank_account_id) continue;
    const dotad = wynik.get(w.bank_account_id);
    if (!dotad || w.booked_on > dotad) wynik.set(w.bank_account_id, w.booked_on);
  }
  return wynik;
}

/** Gdzie klient płaci za najem (decyzja 4, migracja 002): rentals.pay_method + bank_account_id. */
export const MIEJSCA_PLATNOSCI = Object.freeze({ przelew: 'Przelew', gotowka: 'Gotówka', fv: 'Faktura (FV)' });

/** „przelew · Nest – najem”, „przelew · konto nieustalone”, „gotówka”, „FV”. konta: Map(id → konto). */
export function opisPlatnosci(najem, konta = new Map()) {
  const m = najem?.pay_method ?? 'przelew';
  if (m === 'gotowka') return 'gotówka';
  if (m === 'fv') return 'FV';
  const konto = najem?.bank_account_id ? konta.get(najem.bank_account_id) : null;
  return `przelew · ${konto ? konto.name : 'konto nieustalone'}`;
}

/** Wpłata wpisana ręcznie (gotówka albo przelew bez wyciągu) – można ją poprawić i usunąć. */
export const wplataReczna = (w) => w.method === 'gotowka' || (w.method === 'przelew' && !w.dedup_key && !w.import_id);
