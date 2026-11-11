// Profile banków (7.1–7.2): tekst wyciągu → wspólny odczyt wierszy.
// Czyste funkcje. Profile: Nest Bank, Millennium, PKO BP, Alior. Inne banki – ręczne mapowanie kolumn
// zapamiętane przy koncie (bank_accounts.csv_mapping, migracja 005).
//
// Wynik odczytajWyciag(tekst):
//   { bank: 'nest'|'millennium'|null, rachunek: '26 cyfr'|null (konto, z którego jest wyciąg),
//     wiersze: [{ nr, data:'RRRR-MM-DD', kwotaGr, kontrahent, tytul, waluta, rachunekNadawcy, blad? }],
//     blad?: 'komunikat dla użytkownika' }

import { parsujCsv, wykryjSeparator } from './csv.js';
import { normalizujTekst, oczyscRachunek, parseKwota } from './utils.js';

const kluczNaglowka = (pola) => pola.map((p) => normalizujTekst(p));

/**
 * Data z wyciągu → RRRR-MM-DD. Formaty: RRRR-MM-DD, RRRR.MM.DD, RRRR/MM/DD, DD-MM-RRRR, DD.MM.RRRR, DD/MM/RRRR;
 * godzina po dacie jest pomijana („2026-03-01 12:30”). Dzień i miesiąc mogą być jednocyfrowe.
 */
export function dataWyciagu(tekst) {
  const s = String(tekst ?? '').trim().split(/[ T]/)[0];
  const p2 = (x) => x.padStart(2, '0');
  const ok = (y, m, d) => (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${y}-${p2(m)}-${p2(d)}` : null);
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) return ok(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  return m ? ok(m[3], m[2], m[1]) : null;
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
// PKO BP: „Zestawienie_operacji_*.csv”, Windows-1250, każdy wiersz jako jedno pole w cudzysłowie (jak Millennium).
// Kolumny: Data operacji, Data waluty, Typ transakcji, Kwota („+200.00”), Waluta, Saldo po transakcji, Opis transakcji
// i kilka kolumn bez nazwy. Nadawca, rachunek i tytuł są w komórkach opisu: „Nazwa nadawcy: …”, „Rachunek nadawcy: …”,
// „Tytuł: …”. Numeru własnego rachunku w pliku nie ma.
// ---------------------------------------------------------------------

/** Wartość z komórek „Etykieta: wartość” (od kolumny od). */
function zOpisuPKO(pola, od, wzor) {
  for (const p of pola.slice(od)) {
    const m = wzor.exec(p.replace(/^'/, '').trim());
    if (m) return m[1].trim();
  }
  return '';
}

function pko(tekst) {
  const rekordy = rozpakuj(parsujCsv(tekst, wykryjSeparator(tekst)));
  const start = rekordy.findIndex((r) => kluczNaglowka(r.pola).includes('DATA OPERACJI'));
  const n = kluczNaglowka(rekordy[start].pola);
  const i = (nazwa) => n.indexOf(nazwa);
  const kol = { data: i('DATA OPERACJI'), kwota: i('KWOTA'), waluta: i('WALUTA'), opis: i('OPIS TRANSAKCJI') };
  return {
    bank: 'pko',
    rachunek: null,
    wiersze: rekordy.slice(start + 1).map(({ nr, pola }) => wiersz(nr, {
      data: pola[kol.data], kwota: pola[kol.kwota], waluta: pola[kol.waluta],
      kontrahent: zOpisuPKO(pola, kol.opis, /^nazwa (?:nadawcy|odbiorcy)\s*:\s*(.*)$/i),
      rachunek: zOpisuPKO(pola, kol.opis, /^rachunek (?:nadawcy|odbiorcy)\s*:\s*(.*)$/i),
      tytul: zOpisuPKO(pola, kol.opis, /^tytuł\s*:\s*(.*)$/i),
    })),
  };
}

// ---------------------------------------------------------------------
// Alior: „Historia_Operacji_*.csv”, UTF-8, średnik. Nad tabelą linia „Kryteria transakcji: …”.
// Kwota w walucie rachunku („-18,49”), daty DD.MM.RRRR. Własny rachunek = „Numer rachunku odbiorcy” przy wpływie.
// ---------------------------------------------------------------------

function alior(tekst) {
  const rekordy = parsujCsv(tekst, ';');
  const start = rekordy.findIndex((r) => kluczNaglowka(r.pola).includes('NAZWA NADAWCY'));
  const n = kluczNaglowka(rekordy[start].pola);
  const i = (nazwa) => n.indexOf(nazwa);
  const kwota = i('KWOTA W WALUCIE RACHUNKU') >= 0 ? i('KWOTA W WALUCIE RACHUNKU') : i('KWOTA OPERACJI');
  const waluta = i('WALUTA RACHUNKU') >= 0 ? i('WALUTA RACHUNKU') : i('WALUTA OPERACJI');
  const kol = {
    data: i('DATA KSIEGOWANIA') >= 0 ? i('DATA KSIEGOWANIA') : i('DATA TRANSAKCJI'), kwota, waluta,
    kontrahent: i('NAZWA NADAWCY'), tytul: i('SZCZEGOLY TRANSAKCJI'), rachunek: i('NUMER RACHUNKU NADAWCY'),
    odbiorca: i('NUMER RACHUNKU ODBIORCY'),
  };
  const dane = rekordy.slice(start + 1);
  const wplyw = dane.find(({ pola }) => (kwotaWyciagu(pola[kol.kwota]) ?? 0) > 0 && oczyscRachunek(pola[kol.odbiorca]));
  return {
    bank: 'alior',
    rachunek: wplyw ? oczyscRachunek(wplyw.pola[kol.odbiorca]) : null,
    wiersze: dane.map(({ nr, pola }) => wiersz(nr, {
      data: pola[kol.data], kwota: pola[kol.kwota], waluta: pola[kol.waluta],
      kontrahent: pola[kol.kontrahent], rachunek: pola[kol.rachunek], tytul: pola[kol.tytul],
    })),
  };
}

// ---------------------------------------------------------------------
// Ręczne mapowanie kolumn (7.2: „Inny – ręczne mapowanie kolumn zapamiętane jako profil”).
// Mapowanie: { podpis: 'NAGLOWEK|…' (nagłówki bez ogonków), kolumny: { data: 'DATA OPERACJI', kwota: 'KWOTA', … } }.
// Kolumny wskazujemy nazwą nagłówka, nie numerem – plik z dodatkową kolumną dalej się wczyta.
// ---------------------------------------------------------------------

/** Pola wspólnego odczytu. kwota = jedna kolumna ze znakiem; uznania = osobna kolumna wpływów (gdy bank je rozdziela). */
export const POLA_MAPOWANIA = Object.freeze([
  { id: 'data', tekst: 'Data księgowania', wymagane: true, slowa: ['DATA KSIEGOWANIA', 'DATA OPERACJI', 'DATA TRANSAKCJI', 'DATA WALUTY', 'DATA'] },
  { id: 'kwota', tekst: 'Kwota (wpływ dodatni)', wymagane: true, slowa: ['KWOTA OPERACJI', 'KWOTA TRANSAKCJI', 'KWOTA', 'UZNANIA', 'WPLYWY', 'WPLYW'] },
  { id: 'kontrahent', tekst: 'Nadawca', slowa: ['NADAWCA', 'ZLECENIODAWCA', 'DANE KONTRAHENTA', 'KONTRAHENT', 'NAZWA'] },
  { id: 'tytul', tekst: 'Tytuł', slowa: ['TYTUL', 'OPIS OPERACJI', 'OPIS TRANSAKCJI', 'OPIS', 'SZCZEGOLY'] },
  { id: 'rachunek', tekst: 'Rachunek nadawcy (zalecany)', slowa: ['RACHUNEK NADAWCY', 'NUMER RACHUNKU NADAWCY', 'RACHUNEK KONTRAHENTA', 'NUMER RACHUNKU KONTRAHENTA', 'KONTO NADAWCY', 'RACHUNEK'] },
  { id: 'waluta', tekst: 'Waluta', slowa: ['WALUTA'] },
]);

/**
 * Nagłówek i przykładowe wiersze pliku z nieznanego banku. Nagłówek = pierwszy wiersz z największą liczbą pól
 * (wśród pierwszych 30) – linie opisu nad tabelą (numer rachunku, okres) są pomijane.
 * @returns {{ separator, start: number, kolumny: string[], przyklady: string[][] } | null}
 */
export function kolumnyPliku(tekst) {
  const separator = wykryjSeparator(tekst.split(/\r?\n/).find((l) => /[;,\t]/.test(l)) ?? tekst);
  const rekordy = rozpakuj(parsujCsv(tekst, separator));
  const poczatek = rekordy.slice(0, 30);
  const max = Math.max(0, ...poczatek.map((r) => r.pola.length));
  if (max < 2) return null;
  // Nagłówek: wiersz bez dat (≥ 2 niepuste pola), po którym jest wiersz z datą. Zapas: pierwszy najszerszy wiersz.
  const maDate = (r) => r?.pola.some((p) => dataWyciagu(p));
  let i = poczatek.findIndex((r, idx) => r.pola.filter((p) => p.trim()).length >= 2 && !maDate(r) && maDate(poczatek[idx + 1]));
  if (i < 0) i = poczatek.findIndex((r) => r.pola.length === max && r.pola.filter((p) => p.trim()).length >= 2);
  if (i < 0) return null;
  return {
    separator, start: i,
    kolumny: rekordy[i].pola.map((p) => p.trim()),
    przyklady: rekordy.slice(i + 1, i + 4).map((r) => r.pola.map((p) => p.trim())),
  };
}

const podpisNaglowka = (kolumny) => kolumny.map((k) => normalizujTekst(k)).join('|');

/** Podpowiedź mapowania po nazwach nagłówków (kolejność słów kluczowych = pierwszeństwo). */
export function zgadnijMapowanie(kolumny) {
  const n = kolumny.map((k) => normalizujTekst(k));
  const zajete = new Set();
  const wynik = {};
  for (const pole of POLA_MAPOWANIA) {
    for (const slowo of pole.slowa) {
      const i = n.findIndex((k, idx) => !zajete.has(idx) && (k === slowo || k.startsWith(`${slowo} `) || k.includes(slowo)));
      if (i >= 0) {
        wynik[pole.id] = n[i];
        zajete.add(i);
        break;
      }
    }
  }
  return wynik;
}

/** Mapowanie do zapisania przy koncie. kolumny: { pole: 'NAZWA NAGŁÓWKA' } (puste pomijane). */
export function zbudujMapowanie(naglowek, kolumny) {
  const k = Object.fromEntries(Object.entries(kolumny).filter(([, v]) => v).map(([pole, v]) => [pole, normalizujTekst(v)]));
  return { podpis: podpisNaglowka(naglowek), kolumny: k };
}

/** Czy zapamiętane mapowanie pasuje do pliku (te same nagłówki). */
export function mapowaniePasuje(mapowanie, tekst) {
  const k = mapowanie?.podpis && kolumnyPliku(tekst);
  return Boolean(k) && podpisNaglowka(k.kolumny) === mapowanie.podpis;
}

const WZORY_OPISU = Object.freeze({
  kontrahent: /^(?:nazwa nadawcy|nadawca|zleceniodawca)\s*:\s*(.+)$/i,
  rachunek: /^(?:rachunek nadawcy|numer rachunku nadawcy|z rachunku)\s*:\s*(.+)$/i,
  tytul: /^(?:tytuł|tytul)\s*:\s*(.+)$/i,
});

/** Odczyt pliku według mapowania → ten sam układ co profile banków (bank: null = mapowanie ręczne). */
export function odczytajZMapowaniem(tekst, mapowanie) {
  const k = kolumnyPliku(tekst);
  if (!k) return { bank: null, rachunek: null, wiersze: [], blad: 'Ten plik nie wygląda na wyciąg CSV.' };
  const n = k.kolumny.map((x) => normalizujTekst(x));
  const idx = Object.fromEntries(Object.entries(mapowanie.kolumny ?? {}).map(([pole, nazwa]) => [pole, n.indexOf(nazwa)]));
  if (!(idx.data >= 0) || !(idx.kwota >= 0)) {
    return { bank: null, rachunek: null, wiersze: [], blad: 'W pliku nie ma kolumn daty albo kwoty z zapamiętanego mapowania.' };
  }
  // Brak osobnej kolumny: wartość z opisu w stylu „Nazwa nadawcy: JAN NOWAK” w dowolnej komórce wiersza.
  const zOpisu = (pola, id) => {
    const wzor = WZORY_OPISU[id];
    if (!wzor) return undefined;
    for (const p of pola) {
      const m = wzor.exec(p.trim());
      if (m) return m[1];
    }
    return undefined;
  };
  const pole = (pola, id) => (idx[id] >= 0 && String(pola[idx[id]] ?? '').trim() ? pola[idx[id]] : zOpisu(pola, id));
  const rekordy = rozpakuj(parsujCsv(tekst, k.separator));
  const naglowekNr = rekordy[k.start].nr;
  return {
    bank: null, rachunek: null, reczne: true,
    wiersze: rekordy.filter((r) => r.nr > naglowekNr && r.pola.some((p) => p.trim()))
      .map(({ nr, pola }) => wiersz(nr, {
        // Pusta kwota (np. kolumna „Uznania” przy obciążeniu) = 0, czyli wiersz pomijany jak wypływ.
        data: pole(pola, 'data'), kwota: String(pole(pola, 'kwota') ?? '').trim() || '0',
        waluta: pole(pola, 'waluta'), kontrahent: pole(pola, 'kontrahent'), rachunek: pole(pola, 'rachunek'),
        tytul: pole(pola, 'tytul'),
      })),
  };
}

// ---------------------------------------------------------------------

export const OBSLUGIWANE = Object.freeze({ nest: 'Nest Bank', millennium: 'Millennium', pko: 'PKO BP', alior: 'Alior' });

/** Rozpoznaje bank po treści pliku. */
export function rozpoznajBank(tekst) {
  const poczatek = normalizujTekst(tekst.slice(0, 2000));
  if (poczatek.includes('DATA KSIEGOWANIA') && poczatek.includes('DANE KONTRAHENTA')) return 'nest';
  if (poczatek.includes('NUMER RACHUNKU KARTY') && poczatek.includes('UZNANIA')) return 'millennium';
  if (poczatek.includes('DATA OPERACJI') && poczatek.includes('SALDO PO TRANSAKCJI') && poczatek.includes('OPIS TRANSAKCJI')) return 'pko';
  if (poczatek.includes('NAZWA NADAWCY') && poczatek.includes('NAZWA ODBIORCY') && poczatek.includes('SZCZEGOLY TRANSAKCJI')) return 'alior';
  return null;
}

export function odczytajWyciag(tekst) {
  if (!tekst?.trim()) return { bank: null, rachunek: null, wiersze: [], blad: 'Ten plik nie wygląda na wyciąg CSV.' };
  const bank = rozpoznajBank(tekst);
  if (bank === 'nest') return nest(tekst);
  if (bank === 'millennium') return millennium(tekst);
  if (bank === 'pko') return pko(tekst);
  if (bank === 'alior') return alior(tekst);
  return {
    bank: null, rachunek: null, wiersze: [],
    nierozpoznany: true,   // widok proponuje ręczne mapowanie kolumn
    blad: 'Nie rozpoznaję tego wyciągu – wskaż kolumny ręcznie.',
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
