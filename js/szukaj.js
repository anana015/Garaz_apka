// Wyszukiwarka globalna (0.24.0): klienci, jednostki i wpłaty po jednym polu tekstowym. Czyste funkcje (tests/szukaj.test.js).
// Tekst porównywany bez ogonków i wielkości liter (normalizujTekst); „g03”, „G 03” i „G-03” znajdują G-03;
// 3+ cyfry szukają też w telefonie, NIP-ie i rachunku nadawcy; kwota („200”, „200,50”) – w kwotach wpłat.

import { normalizujTekst, parseKwota } from './utils.js';

export const LIMIT_WYNIKOW = 20;

const bezSpacji = (t) => normalizujTekst(t).replace(/ /g, '');
const cyfry = (t) => String(t ?? '').replace(/\D/g, '');

/** Zapytanie rozłożone raz: słowa (wszystkie muszą pasować), zlepione znaki, cyfry, kwota. */
export function przygotujZapytanie(tekst) {
  const norm = normalizujTekst(tekst);
  const c = cyfry(tekst);
  const kwota = /^\s*\d+([.,]\d{1,2})?\s*(zł|zl)?\s*$/i.test(String(tekst ?? '')) ? parseKwota(String(tekst).replace(/z[łl]/i, '')) : null;
  return { norm, slowa: norm ? norm.split(' ') : [], zlepione: norm.replace(/ /g, ''), cyfry: c.length >= 3 ? c : '', kwotaGr: kwota };
}

/** Czy tekst pasuje: każde słowo zapytania występuje w tekście (kolejność dowolna) albo zlepione zapytanie w zlepionym tekście. */
export function pasuje(z, ...pola) {
  if (!z.slowa.length) return false;
  const tekst = pola.map(normalizujTekst).join(' ');
  if (z.slowa.every((s) => tekst.includes(s))) return true;
  return z.zlepione.length >= 2 && tekst.replace(/ /g, '').includes(z.zlepione);
}

/**
 * Wyniki wyszukiwania.
 * @param {{ dane, indeksy }} s
 * @param {string} tekst
 * @param {{ tylkoKlienci?: boolean, dzis: string }} opcje
 * @returns {{ klienci: object[], jednostki: object[], wplaty: object[], razem: number }}
 */
export function szukajWszedzie(s, tekst, { tylkoKlienci = false, dzis } = {}) {
  const z = przygotujZapytanie(tekst);
  const pusto = { klienci: [], jednostki: [], wplaty: [], razem: 0 };
  if (z.norm.length < 2 && !z.cyfry) return pusto;

  const klienci = s.dane.clients.filter((k) => pasuje(z, k.name, k.email, k.contact_person, k.address)
    || (z.cyfry && [k.phone, k.nip].some((p) => cyfry(p).includes(z.cyfry))))
    .sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived))
      || Number(!normalizujTekst(a.name).startsWith(z.norm)) - Number(!normalizujTekst(b.name).startsWith(z.norm))
      || a.name.localeCompare(b.name, 'pl'));
  if (tylkoKlienci) return { ...pusto, klienci: klienci.slice(0, LIMIT_WYNIKOW), razem: klienci.length };

  const jednostki = s.dane.units.filter((j) => !j.archived && (bezSpacji(j.code).includes(z.zlepione) || pasuje(z, j.code, j.description)))
    .sort((a, b) => Number(bezSpacji(a.code) !== z.zlepione) - Number(bezSpacji(b.code) !== z.zlepione) || a.code.localeCompare(b.code, 'pl', { numeric: true }));

  const wplaty = s.dane.payments.filter((w) => (z.kwotaGr != null && Math.abs(w.amount_gr) === z.kwotaGr)
    || pasuje(z, w.counterparty, w.title, w.note)
    || (z.cyfry && z.cyfry.length >= 6 && cyfry(w.payer_account).includes(z.cyfry)))
    .filter((w) => !dzis || w.booked_on <= dzis)
    .sort((a, b) => b.booked_on.localeCompare(a.booked_on));

  return {
    klienci: klienci.slice(0, LIMIT_WYNIKOW),
    jednostki: jednostki.slice(0, LIMIT_WYNIKOW),
    wplaty: wplaty.slice(0, LIMIT_WYNIKOW),
    razem: klienci.length + jednostki.length + wplaty.length,
  };
}
