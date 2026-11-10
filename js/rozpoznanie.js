// Rozpoznanie płatnika (5.2) – czyste funkcje.
// Kolejność: zapamiętany rachunek (payers.account) → zapamiętana nazwa (payers.name_key) →
// rachunek z wcześniej przypisanej wpłaty → wszystkie słowa nazwy klienta w nazwie nadawcy (jeden klient).

import { normalizujTekst } from './utils.js';

const FORMY_PRAWNE = /\b(SP Z O O|SPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA|SP J|SP K|S C|S A|P H U|PHU|F H U|FHU|P P H U|PPHU)\b/g;

/** Nazwa do porównań: normalizujTekst + bez form prawnych i skrótów typu P.H.U. */
export function kluczNazwy(tekst) {
  return normalizujTekst(tekst).replace(FORMY_PRAWNE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Indeks do szybkiego rozpoznawania – budowany raz na import.
 * @param {{ payers: Array, clients: Array, payments: Array }} dane
 */
export function indeksPlatnikow({ payers = [], clients = [], payments = [] }) {
  const aktywni = clients.filter((k) => !k.archived);
  const zRachunku = new Map(payers.filter((p) => p.account).map((p) => [p.account, p.client_id]));
  // Wcześniejsze wpłaty z rachunkiem i klientem – gdy rachunek nie jest zapamiętany, a wszystkie wskazują jednego klienta.
  const historia = new Map();
  for (const w of payments) {
    if (!w.payer_account || !w.client_id || w.kind === 'pominieta') continue;
    const zbior = historia.get(w.payer_account) ?? new Set();
    zbior.add(w.client_id);
    historia.set(w.payer_account, zbior);
  }
  return {
    zRachunku,
    historia,
    nazwy: payers.filter((p) => p.name_key).map((p) => ({ klucz: p.name_key, klientId: p.client_id })),
    klienci: aktywni.map((k) => ({ id: k.id, slowa: kluczNazwy(k.name).split(' ').filter((s) => s.length > 1) }))
      .filter((k) => k.slowa.length),
  };
}

/**
 * @returns {{ klientId: string|null, metoda: 'rachunek'|'nazwa'|null, potwierdzone: boolean }}
 */
export function rozpoznaj(w, indeks) {
  const brak = { klientId: null, metoda: null, potwierdzone: false };
  if (w.rachunekNadawcy) {
    const id = indeks.zRachunku.get(w.rachunekNadawcy);
    if (id) return { klientId: id, metoda: 'rachunek', potwierdzone: true };
    const z = indeks.historia.get(w.rachunekNadawcy);
    if (z?.size === 1) return { klientId: [...z][0], metoda: 'rachunek', potwierdzone: true };
  }
  const nazwa = kluczNazwy(w.kontrahent);
  if (!nazwa) return brak;
  const zapamietana = indeks.nazwy.find((n) => nazwa === n.klucz || nazwa.includes(n.klucz));
  if (zapamietana) return { klientId: zapamietana.klientId, metoda: 'nazwa', potwierdzone: true };
  // Banki zamieniają czasem nietypowe litery na „?” (DANIËL → DANI?L): „?” pasuje do dowolnej litery.
  const slowaNadawcy = kluczNazwy(String(w.kontrahent).replace(/\?/g, '0')).split(' ');
  const rowne = (a, b) => a.length === b.length && [...a].every((z, i) => z === b[i] || z === '0');
  const pasujacy = indeks.klienci.filter((k) => k.slowa.every((s) => slowaNadawcy.some((n) => rowne(n, s))));
  if (pasujacy.length === 1) return { klientId: pasujacy[0].id, metoda: 'nazwa', potwierdzone: false };
  return brak;
}

/**
 * Co zapamiętać przy ręcznym przypisaniu (5.2): rachunek, a gdy go brak – znormalizowaną nazwę.
 * Zwraca { wpis: {account|name_key} | null, konflikt: payer innego klienta | null, istnieje: boolean }.
 */
export function planZapamietania(wplata, klientId, payers = []) {
  const wpis = wplata.payer_account ? { account: wplata.payer_account, name_key: null }
    : kluczNazwy(wplata.counterparty) ? { account: null, name_key: kluczNazwy(wplata.counterparty) } : null;
  if (!wpis) return { wpis: null, konflikt: null, istnieje: false };
  const ten = payers.find((p) => (wpis.account ? p.account === wpis.account : p.name_key === wpis.name_key));
  if (ten && ten.client_id !== klientId) return { wpis: null, konflikt: ten, istnieje: false };
  return { wpis: ten ? null : wpis, konflikt: null, istnieje: Boolean(ten) };
}

/** Pozostałe wpłaty „Do przypisania”, które pasują do zapamiętanego płatnika. */
export function pasujaceDoPlatnika(platnik, wplaty, pominId = null) {
  return wplaty.filter((w) => w.id !== pominId && w.kind === 'czynsz' && !w.client_id && w.method === 'przelew'
    && (platnik.account ? w.payer_account === platnik.account
      : (() => { const n = kluczNazwy(w.counterparty); return n && (n === platnik.name_key || n.includes(platnik.name_key)); })()));
}
