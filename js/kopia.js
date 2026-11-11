// Kopia zapasowa JSON (rozdz. 10): wszystkie tabele z rozdziału 4, pola version i exported_at.
// Czyste funkcje (tests/kopia.test.js). Zapis do bazy: funkcja wczytaj_kopie (migracja 004) – wszystko albo nic.

import { TABELE } from './config.js';

/** Wersja FORMATU kopii (nie aplikacji). Kopia z wyższą wersją jest odrzucana. */
export const WERSJA_KOPII = 1;
const APLIKACJA = 'najem-magazynow';

/**
 * Kopia danych gotowa do zapisania jako plik .json.
 * @param {object} dane state.dane (tablice tabel, settings jako obiekt)
 * @param {{ wersjaAplikacji: string, teraz: string }} o teraz – ISO znacznik czasu
 */
export function zbudujKopie(dane, { wersjaAplikacji, teraz }) {
  const tabele = {};
  for (const t of TABELE) tabele[t] = t === 'settings' ? (dane.settings ? [dane.settings] : []) : (dane[t] ?? []);
  return { app: APLIKACJA, version: WERSJA_KOPII, app_version: wersjaAplikacji, exported_at: teraz, tables: tabele };
}

/** Nazwa pliku: najem_kopia_2026-11-11_0815.json */
export function nazwaPlikuKopii(teraz) {
  return `najem_kopia_${teraz.slice(0, 10)}_${teraz.slice(11, 16).replace(':', '')}.json`;
}

/**
 * Sprawdza wczytany plik kopii przed zapisem do bazy.
 * @param {string} tekst zawartość pliku
 * @returns {{ blad: string|null, kopia?: object, liczby?: Record<string, number> }}
 */
export function sprawdzKopie(tekst) {
  let k;
  try {
    k = JSON.parse(String(tekst).replace(/^﻿/, ''));
  } catch {
    return { blad: 'Ten plik nie jest kopią zapasową (nieprawidłowy JSON).' };
  }
  if (!k || typeof k !== 'object' || k.app !== APLIKACJA || !k.tables || typeof k.tables !== 'object') {
    return { blad: 'Ten plik nie jest kopią zapasową aplikacji Najem magazynów.' };
  }
  if (!Number.isInteger(k.version) || k.version < 1) return { blad: 'Kopia nie ma poprawnego numeru wersji.' };
  if (k.version > WERSJA_KOPII) {
    return { blad: `Kopia pochodzi z nowszej wersji aplikacji (${k.app_version ?? `format ${k.version}`}). Zaktualizuj aplikację.` };
  }
  const liczby = {};
  for (const t of TABELE) {
    const w = k.tables[t] ?? [];
    if (!Array.isArray(w) || w.some((r) => !r || typeof r !== 'object')) return { blad: `Uszkodzona tabela w kopii: ${t}.` };
    if (t !== 'settings' && w.some((r) => typeof r.id !== 'string')) return { blad: `Wiersze bez identyfikatora w tabeli ${t}.` };
    liczby[t] = w.length;
  }
  if (liczby.settings > 1) return { blad: 'Kopia ma więcej niż jeden wiersz ustawień.' };
  // Tabele spoza listy (np. z przyszłych etapów) są pomijane, nie przerywają wczytania.
  const tables = Object.fromEntries(TABELE.map((t) => [t, k.tables[t] ?? []]));
  return { blad: null, kopia: { ...k, tables }, liczby };
}

// ---------------------------------------------------------------------
// Kopia z dokumentami (ZIP): JSON + PDF-y umów + wzory umów (.docx)
// ---------------------------------------------------------------------

/** Nazwa pliku JSON wewnątrz ZIP-a. */
export const JSON_W_ZIP = 'kopia.json';

/** najem_kopia_dokumenty_2026-11-11_0815.zip */
export const nazwaPlikuZip = (teraz) => nazwaPlikuKopii(teraz).replace('najem_kopia_', 'najem_kopia_dokumenty_').replace(/\.json$/, '.zip');

/** Ścieżka wzoru umowy w buckecie „umowy” (migracja 011). */
export const sciezkaWzoru = (userId, wzorId) => `${userId}/wzory/${wzorId}.docx`;

/**
 * Pliki do dołączenia do ZIP-a: PDF-y umów (contracts.pdf_path) i wzory (settings.contract_templates).
 * @returns {Array<{ sciezka: string, wZip: string }>} sciezka – w buckecie, wZip – nazwa w archiwum
 */
export function plikiDokumentow(dane, userId) {
  const pliki = [];
  for (const u of dane.contracts ?? []) {
    if (u.pdf_path) pliki.push({ sciezka: u.pdf_path, wZip: `umowy/${u.id}.pdf` });
  }
  for (const w of dane.settings?.contract_templates ?? []) {
    if (w?.id) pliki.push({ sciezka: sciezkaWzoru(userId, w.id), wZip: `wzory/${w.id}.docx` });
  }
  return pliki;
}

/**
 * Po odczytaniu ZIP-a: które pliki wgrać z powrotem i gdzie, oraz kopia z poprawionymi ścieżkami PDF
 * (kopia mogła pochodzić z innego konta – ścieżka zawiera id użytkownika).
 * @param {object} kopia wynik sprawdzKopie().kopia
 * @param {string[]} nazwy nazwy plików w archiwum
 * @param {string} userId
 * @returns {{ kopia, doWgrania: Array<{ wZip, sciezka, typ }> }}
 */
export function planPrzywracania(kopia, nazwy, userId) {
  const zbior = new Set(nazwy);
  const doWgrania = [];
  const contracts = kopia.tables.contracts.map((u) => {
    const wZip = `umowy/${u.id}.pdf`;
    if (!zbior.has(wZip)) return u;
    const sciezka = `${userId}/${u.id}.pdf`;
    doWgrania.push({ wZip, sciezka, typ: 'application/pdf' });
    return { ...u, pdf_path: sciezka };
  });
  for (const w of kopia.tables.settings[0]?.contract_templates ?? []) {
    const wZip = `wzory/${w?.id}.docx`;
    if (w?.id && zbior.has(wZip)) {
      doWgrania.push({ wZip, sciezka: sciezkaWzoru(userId, w.id),
        typ: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
  }
  return { kopia: { ...kopia, tables: { ...kopia.tables, contracts } }, doWgrania };
}
