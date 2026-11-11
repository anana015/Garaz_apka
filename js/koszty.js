// Etap 2 – koszty i zysk (specyfikacja, rozdz. 15). Czyste funkcje: kategorie, reguły „fraza → kategoria”,
// ryczałt przypadający na zakres dat i zysk = przychód − koszty − ryczałt (także na jednostkę i typ).
// Przy ryczałcie koszty nie zmniejszają podatku – zysk jest wskaźnikiem do zarządzania, nie do rozliczeń z urzędem.

import { daneGrupy, GRUPY_RYCZALTU, ryczaltOd } from './podatek.js';
import { normalizujTekst } from './utils.js';

export const KATEGORIE = Object.freeze({
  prad: 'Prąd',
  naprawy: 'Naprawy',
  podatek_nieruchomosci: 'Podatek od nieruchomości',
  ubezpieczenie: 'Ubezpieczenie',
  oplaty_bankowe: 'Opłaty bankowe',
  inne: 'Inne',
});
/** Wypływ z wyciągu, który nie jest kosztem (np. przelew własny, wypłata, ryczałt) – zapisany, żeby nie wracał. */
export const POMINIETY = 'pominiety';
export const nazwaKategorii = (k) => (k === POMINIETY ? 'Pominięty (nie koszt)' : KATEGORIE[k] ?? k);

const PRZYCHOD = new Set(['czynsz', 'przychod_inny']);

/** Koszty (bez pominiętych) z datą w zakresie. */
export const kosztyZakresu = (expenses = [], od, doDnia) =>
  expenses.filter((e) => e.category !== POMINIETY && e.spent_on >= od && e.spent_on <= doDnia);

/**
 * Reguła pasująca do wypływu: fraza (bez ogonków, wielkość liter bez znaczenia) zawarta w nazwie kontrahenta
 * albo tytule. Przy kilku – najdłuższa fraza. null, gdy żadna nie pasuje.
 */
export function dopasujRegule(w, reguly = []) {
  const tekst = normalizujTekst(`${w.kontrahent ?? w.counterparty ?? ''} ${w.tytul ?? w.title ?? ''}`);
  if (!tekst) return null;
  return reguly.filter((r) => r.phrase && tekst.includes(normalizujTekst(r.phrase)))
    .sort((a, b) => b.phrase.length - a.phrase.length)[0] ?? null;
}

/** Fraza reguły z nazwy kontrahenta: pierwsze 3 słowa, bez form prawnych i numerów (np. „ENERGA OBROT”). */
export function frazaZKontrahenta(kontrahent) {
  const slowa = String(kontrahent ?? '').toUpperCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/)
    .filter((x) => x.length > 1 && !/^\d+$/.test(x) && !['SP', 'Z', 'O', 'OO', 'SA', 'S', 'A'].includes(x));
  return slowa.slice(0, 3).join(' ');
}

/**
 * Ryczałt przypadający na zakres dat: dla każdego licznika (Millennium, pozostałe konta, gotówka) i każdego roku
 * f(przychód od 1.01 do końca zakresu) − f(przychód od 1.01 do dnia przed zakresem). Bez zaokrągleń kwartalnych –
 * kwota orientacyjna do wyliczenia zysku.
 */
export function ryczaltZakresu(dane, od, doDnia, ustawienia) {
  let suma = 0;
  for (let rok = Number(od.slice(0, 4)); rok <= Number(doDnia.slice(0, 4)); rok++) {
    const poczatekRoku = `${rok}-01-01`;
    const a = od > poczatekRoku ? od : poczatekRoku;
    const b = doDnia < `${rok}-12-31` ? doDnia : `${rok}-12-31`;
    for (const g of GRUPY_RYCZALTU) {
      const wplaty = daneGrupy(dane, g.id).payments.filter((w) => PRZYCHOD.has(w.kind) && w.booked_on.startsWith(`${rok}-`));
      const przed = wplaty.filter((w) => w.booked_on < a).reduce((x, w) => x + w.amount_gr, 0);
      const wZakresie = wplaty.filter((w) => w.booked_on >= a && w.booked_on <= b).reduce((x, w) => x + w.amount_gr, 0);
      suma += ryczaltOd(przed + wZakresie, ustawienia) - ryczaltOd(przed, ustawienia);
    }
  }
  return Math.round(suma);
}

/**
 * Zysk w zakresie dat.
 * Całość: przychód kasowy (wpłaty czynsz + inne przychody) − koszty − ryczałt.
 * Na jednostkę: opłacone należności jej najmów z terminem w zakresie (jak w Raportach) − koszty przypisane do
 * jednostki − udział w kosztach wspólnych i w ryczałcie (oba proporcjonalnie do przychodu jednostki).
 * @param {object} dane state.dane
 * @param {{ od, do, ustawienia, pozycje }} o pozycje – należności z rozliczeń klientów (rozliczenia.js)
 */
export function zyskZakresu(dane, { od, do: doDnia, ustawienia, pozycje = [] }) {
  const przychodGr = dane.payments.filter((w) => PRZYCHOD.has(w.kind) && w.booked_on >= od && w.booked_on <= doDnia)
    .reduce((x, w) => x + w.amount_gr, 0);
  const koszty = kosztyZakresu(dane.expenses, od, doDnia);
  const kosztyGr = koszty.reduce((x, e) => x + e.amount_gr, 0);
  const ryczaltGr = ryczaltZakresu(dane, od, doDnia, ustawienia);
  const wgKategorii = Object.keys(KATEGORIE).map((k) => ({
    kategoria: k, gr: koszty.filter((e) => e.category === k).reduce((x, e) => x + e.amount_gr, 0),
  })).filter((x) => x.gr);

  // Na jednostkę
  const jednostki = new Map();
  const wiersz = (id) => {
    if (!jednostki.has(id)) jednostki.set(id, { jednostkaId: id, przychodGr: 0, kosztyGr: 0 });
    return jednostki.get(id);
  };
  for (const p of pozycje) {
    if (p.otwarcie || p.termin < od || p.termin > doDnia) continue;
    wiersz(p.jednostkaId).przychodGr += Math.min(p.zaplaconoGr, p.kwotaGr);
  }
  let wspolneGr = 0;
  for (const e of koszty) {
    if (e.unit_id) wiersz(e.unit_id).kosztyGr += e.amount_gr;
    else wspolneGr += e.amount_gr;
  }
  const przychodJednostekGr = [...jednostki.values()].reduce((x, j) => x + j.przychodGr, 0);
  const naJednostke = [...jednostki.values()].map((j) => {
    const udzial = przychodJednostekGr ? j.przychodGr / przychodJednostekGr : 0;
    const wspolne = Math.round(wspolneGr * udzial);
    const ryczalt = Math.round(ryczaltGr * udzial);
    return { ...j, wspolneGr: wspolne, ryczaltGr: ryczalt, zyskGr: j.przychodGr - j.kosztyGr - wspolne - ryczalt };
  });

  return {
    przychodGr, kosztyGr, ryczaltGr, zyskGr: przychodGr - kosztyGr - ryczaltGr,
    wgKategorii, wspolneGr, naJednostke,
  };
}
