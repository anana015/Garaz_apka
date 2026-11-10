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
