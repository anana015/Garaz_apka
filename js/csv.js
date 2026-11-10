// Odczyt i zapis CSV (7.2, 7.5, rozdz. 10). Czyste funkcje – tests/csv.test.js.
// Użyje ich też import wyciągów (krok 1b). Własny parser zamiast PapaParse: ~60 linii,
// bez zależności, działa offline i w testach Node.

import { normalizujTekst } from './utils.js';

const BOM = '﻿';

/**
 * Bajty pliku → tekst. UTF-8, a gdy pojawi się znak zastępczy „�”, Windows-1250
 * (Excel w polskiej wersji zapisuje „CSV (rozdzielany przecinkami)” w tym kodowaniu). BOM usuwany.
 * @param {ArrayBuffer|Uint8Array} bajty
 */
export function dekoduj(bajty) {
  const utf8 = new TextDecoder('utf-8').decode(bajty);
  const tekst = utf8.includes('�') ? new TextDecoder('windows-1250').decode(bajty) : utf8;
  return tekst.startsWith(BOM) ? tekst.slice(1) : tekst;
}

/** Separator z pierwszego wiersza: średnik, przecinek albo tabulator – którego jest najwięcej poza cudzysłowami. */
export function wykryjSeparator(tekst) {
  const pierwszy = tekst.replace(/^﻿/, '').split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const liczby = [';', ',', '\t'].map((z) => [z, pierwszy.split(z).length - 1]);
  liczby.sort((a, b) => b[1] - a[1]);
  return liczby[0][1] > 0 ? liczby[0][0] : ';';
}

/**
 * Parser zgodny z RFC 4180: pola w cudzysłowach mogą zawierać separator, nowy wiersz i "" (cudzysłów).
 * Puste wiersze są pomijane, ale numeracja się zgadza z numerami wierszy w Excelu (nagłówek = 1).
 * @returns {Array<{ nr: number, pola: string[] }>}
 */
export function parsujCsv(tekst, separator = wykryjSeparator(tekst)) {
  const s = tekst.startsWith(BOM) ? tekst.slice(1) : tekst;
  const rekordy = [];
  let pola = [];
  let pole = '';
  let wCudzyslowie = false;
  let nr = 1;
  const zamknijRekord = () => {
    pola.push(pole);
    if (pola.length > 1 || pola[0].trim() !== '') rekordy.push({ nr, pola });
    pola = [];
    pole = '';
    nr += 1;
  };

  for (let i = 0; i < s.length; i++) {
    const z = s[i];
    if (wCudzyslowie) {
      if (z !== '"') pole += z;
      else if (s[i + 1] === '"') { pole += '"'; i++; }   // "" w środku pola = jeden cudzysłów
      else wCudzyslowie = false;
      continue;
    }
    if (z === '"' && pole === '') wCudzyslowie = true;
    else if (z === separator) { pola.push(pole); pole = ''; }
    else if (z === '\n') zamknijRekord();
    else if (z === '\r') { if (s[i + 1] !== '\n') zamknijRekord(); }   // \r\n zamyka przy \n
    else pole += z;
  }
  if (pole !== '' || pola.length) zamknijRekord();
  return rekordy;
}

/**
 * Rekordy z nagłówkiem → obiekty z kluczami jak w szablonie. Nagłówki porównywane bez wielkości liter,
 * ogonków i różnicy „_”/spacja („Powierzchnia m2” = „powierzchnia_m2”).
 * @param {Array<{nr, pola}>} rekordy wynik parsujCsv
 * @param {string[]} kolumny nazwy kolumn szablonu
 * @returns {{ wiersze: Array<{nr: number, w: object}>, brakujace: string[] }}
 */
export function naObiekty(rekordy, kolumny) {
  if (!rekordy.length) return { wiersze: [], brakujace: [...kolumny] };
  const [naglowek, ...dane] = rekordy;
  const klucz = (t) => normalizujTekst(t);
  const indeksy = new Map(naglowek.pola.map((n, i) => [klucz(n), i]));
  const pozycje = kolumny.map((k) => [k, indeksy.get(klucz(k))]);
  return {
    brakujace: pozycje.filter(([, i]) => i == null).map(([k]) => k),
    wiersze: dane.map(({ nr, pola }) => ({
      nr,
      w: Object.fromEntries(pozycje.map(([k, i]) => [k, i == null ? '' : (pola[i] ?? '').trim()])),
    })),
  };
}

/** Pole CSV w cudzysłowie, gdy zawiera separator, cudzysłów albo nowy wiersz. */
function polePliku(wartosc, separator) {
  const s = String(wartosc ?? '');
  return /["\r\n]/.test(s) || s.includes(separator) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Plik CSV dla Excela (rozdz. 10): średnik, UTF-8 z BOM, wiersze zakończone \r\n.
 * @param {string[]} naglowek
 * @param {Array<Array>} wiersze
 */
export function doCsv(naglowek, wiersze = [], separator = ';') {
  return BOM + [naglowek, ...wiersze].map((w) => w.map((p) => polePliku(p, separator)).join(separator)).join('\r\n') + '\r\n';
}
