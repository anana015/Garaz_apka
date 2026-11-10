// Profile banków (7.1–7.2): tekst wyciągu → wspólny odczyt wierszy.
// Czyste funkcje. Obsługiwane: Nest Bank, Millennium. PKO BP i Alior – po otrzymaniu przykładowych plików.
//
// Wynik odczytajWyciag(tekst):
//   { bank: 'nest'|'millennium'|null, rachunek: '26 cyfr'|null (konto, z którego jest wyciąg),
//     wiersze: [{ nr, data:'RRRR-MM-DD', kwotaGr, kontrahent, tytul, waluta, rachunekNadawcy, blad? }],
//     blad?: 'komunikat dla użytkownika' }

import { parsujCsv, wykryjSeparator } from './csv.js';
import { normalizujTekst, oczyscRachunek, parseKwota } from './utils.js';

const kluczNaglowka = (pola) => pola.map((p) => normalizujTekst(p));

/** Data z wyciągu: RRRR-MM-DD albo DD-MM-RRRR / DD.MM.RRRR → RRRR-MM-DD. */
function dataWyciagu(tekst) {
  const s = String(tekst ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[-.](\d{2})[-.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Kwota z wyciągu (kropka albo przecinek dziesiętny) → grosze. */
const kwotaWyciagu = (tekst) => parseKwota(String(tekst ?? '').trim());

function wiersz(nr, { data, kwota, kontrahent, tytul, waluta, rachunek }) {
  const w = {
    nr,
    data: dataWyciagu(data),
    kwotaGr: kwotaWyciagu(kwota),
    kontrahent: String(kontrahent ?? '').replace(/\s+/g, ' ').trim(),
    tytul: String(tytul ?? '').replace(/\s+/g, ' ').trim(),
    waluta: String(waluta ?? 'PLN').trim().toUpperCase() || 'PLN',
    rachunekNadawcy: oczyscRachunek(rachunek),
  };
  if (!w.data) w.blad = 'Nieczytelna data.';
  else if (w.kwotaGr == null) w.blad = 'Nieczytelna kwota.';
  else if (w.waluta !== 'PLN') w.blad = `Waluta ${w.waluta} – zapisujemy tylko PLN.`;
  return w;
}

// ---------------------------------------------------------------------
// Nest Bank: kilka linii opisu („Numer rachunku: …”), potem nagłówek „Data księgowania,…”.
// Dane kontrahenta: „NAZWA|ADRES” – bierzemy część przed „|”.
// ---------------------------------------------------------------------

function nest(tekst) {
  const linie = tekst.split(/\r?\n/);
  const rachunek = oczyscRachunek(/Numer rachunku:\s*([\dPL\s]+)/i.exec(tekst)?.[1]);
  const start = linie.findIndex((l) => normalizujTekst(l).startsWith('DATA KSIEGOWANIA'));
  const tresc = linie.slice(start).join('\n');
  const rekordy = parsujCsv(tresc, wykryjSeparator(tresc));
  const [naglowek, ...dane] = rekordy;
  const n = kluczNaglowka(naglowek.pola);
  const i = (nazwa) => n.indexOf(nazwa);
  const kol = {
    data: i('DATA KSIEGOWANIA'), kwota: i('KWOTA'), waluta: i('WALUTA'),
    kontrahent: i('DANE KONTRAHENTA'), rachunek: i('NUMER RACHUNKU KONTRAHENTA'), tytul: i('TYTUL OPERACJI'),
  };
  return {
    bank: 'nest',
    rachunek,
    wiersze: dane.map(({ nr, pola }) => wiersz(nr + start, {
      data: pola[kol.data], kwota: pola[kol.kwota], waluta: pola[kol.waluta],
      kontrahent: String(pola[kol.kontrahent] ?? '').split('|')[0],
      rachunek: pola[kol.rachunek], tytul: pola[kol.tytul],
    })),
  };
}

// ---------------------------------------------------------------------
// Millennium: „Historia_transakcji_*.csv”. Każdy wiersz bywa zapisany jako jedno pole w cudzysłowie
// (w środku pola rozdzielone przecinkami, cudzysłowy podwojone) – wtedy rozpakowujemy go drugi raz.
// Kwota: Uznania (wpływ) albo Obciążenia (wypływ, ujemne).
// ---------------------------------------------------------------------

function rozpakuj(rekordy) {
  return rekordy.map((r) => (r.pola.length === 1 && r.pola[0].includes(',')
    ? { nr: r.nr, pola: parsujCsv(r.pola[0], ',')[0]?.pola ?? r.pola }
    : r));
}

function millennium(tekst) {
  const rekordy = rozpakuj(parsujCsv(tekst, wykryjSeparator(tekst)));
  const [naglowek, ...dane] = rekordy;
  const n = kluczNaglowka(naglowek.pola);
  const i = (nazwa) => n.indexOf(nazwa);
  const kol = {
    wlasny: i('NUMER RACHUNKU KARTY'), data: i('DATA ROZLICZENIA') >= 0 ? i('DATA ROZLICZENIA') : i('DATA TRANSAKCJI'),
    rachunek: i('NA KONTO Z KONTA'), kontrahent: i('ODBIORCA ZLECENIODAWCA'), tytul: i('OPIS'),
    obciazenia: i('OBCIAZENIA'), uznania: i('UZNANIA'), waluta: i('WALUTA'),
  };
  return {
    bank: 'millennium',
    rachunek: oczyscRachunek(dane[0]?.pola[kol.wlasny]),
    wiersze: dane.map(({ nr, pola }) => {
      const uznanie = String(pola[kol.uznania] ?? '').trim();
      const obciazenie = String(pola[kol.obciazenia] ?? '').trim();
      return wiersz(nr, {
        data: pola[kol.data], kwota: uznanie || obciazenie, waluta: pola[kol.waluta],
        kontrahent: pola[kol.kontrahent], rachunek: pola[kol.rachunek], tytul: pola[kol.tytul],
      });
    }),
  };
}

// ---------------------------------------------------------------------

export const OBSLUGIWANE = Object.freeze({ nest: 'Nest Bank', millennium: 'Millennium' });

/** Rozpoznaje bank po treści pliku. */
export function rozpoznajBank(tekst) {
  const poczatek = normalizujTekst(tekst.slice(0, 2000));
  if (poczatek.includes('DATA KSIEGOWANIA') && poczatek.includes('DANE KONTRAHENTA')) return 'nest';
  if (poczatek.includes('NUMER RACHUNKU KARTY') && poczatek.includes('UZNANIA')) return 'millennium';
  return null;
}

export function odczytajWyciag(tekst) {
  if (!tekst?.trim()) return { bank: null, rachunek: null, wiersze: [], blad: 'Ten plik nie wygląda na wyciąg CSV.' };
  const bank = rozpoznajBank(tekst);
  if (bank === 'nest') return nest(tekst);
  if (bank === 'millennium') return millennium(tekst);
  return {
    bank: null, rachunek: null, wiersze: [],
    blad: 'Nie rozpoznaję tego wyciągu. Na razie obsługuję CSV z Nest Banku i Millennium – PKO BP i Alior dojdą, gdy dostanę przykładowe pliki.',
  };
}

/**
 * Klucz duplikatu: konto, data, kwota, rachunek albo nazwa nadawcy, tytuł oraz numer powtórzenia
 * (dwie identyczne wpłaty tego samego dnia są dwiema wpłatami).
 */
export function kluczeDuplikatow(kontoId, wiersze) {
  const licznik = new Map();
  return wiersze.map((w) => {
    const baza = [kontoId, w.data, w.kwotaGr, w.rachunekNadawcy ?? normalizujTekst(w.kontrahent),
      normalizujTekst(w.tytul)].join('|');
    const n = (licznik.get(baza) ?? 0) + 1;
    licznik.set(baza, n);
    return `${baza}|${n}`;
  });
}
