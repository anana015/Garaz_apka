// Ryczałt kwartalny od najmu prywatnego, próg 100 000 zł i zestawienie roczne do PIT-28 (rozdz. 6.2, 6.3, 6.5).
// Czyste funkcje: dostają tablice danych i ustawienia, nie dotykają interfejsu ani bazy (tests/podatek.test.js).
//
// Przychód = wpłaty kind 'czynsz' albo 'przychod_inny' z datą księgowania w okresie (5.7): przelewy,
// gotówka, wpłaty nieprzypisane i zatrzymane kaucje (method 'kaucja'). Zwroty (kwoty ujemne) go pomniejszają.
// Kwoty liczone są orientacyjnie i nie zastępują księgowej.

import { iso, kluczMiesiaca, zakresMiesiecy } from './utils.js';

const PRZYCHOD = new Set(['czynsz', 'przychod_inny']);
export const KWARTALY = Object.freeze(['I', 'II', 'III', 'IV']);
export const etykietaKwartalu = (q) => `${KWARTALY[q - 1]} kw.`;

/**
 * Osobne liczniki ryczałtu (prośba 11.11.2026): konto Millennium, pozostałe konta, gotówka.
 * Każdy ma własny próg 100 000 zł, własny ryczałt kwartalny i własne wpłaty (tax_payments.grupa, migracja 008).
 * Przelew bez wskazanego konta i pokrycie z kaucji liczą się do „pozostałych kont”.
 */
export const GRUPY_RYCZALTU = Object.freeze([
  { id: 'millennium', nazwa: 'Konto Millennium' },
  { id: 'pozostale', nazwa: 'Pozostałe konta' },
  { id: 'gotowka', nazwa: 'Gotówka' },
]);
export const nazwaGrupy = (id) => GRUPY_RYCZALTU.find((g) => g.id === id)?.nazwa ?? id;

/** Licznik ryczałtu wpłaty: 'millennium' | 'pozostale' | 'gotowka'. bankKonta: Map(id konta → bank). */
export function grupaWplaty(w, bankKonta) {
  if (w.method === 'gotowka') return 'gotowka';
  return w.bank_account_id && bankKonta.get(w.bank_account_id) === 'millennium' ? 'millennium' : 'pozostale';
}

/** Licznik wpłaty ryczałtu (wpłaty sprzed migracji 008 nie mają grupy – „pozostałe konta”). */
export const grupaWplatyPodatku = (t) => t.grupa ?? 'pozostale';

/** Dane ograniczone do jednego licznika: wpłaty przychodu i wpłaty ryczałtu tej grupy. */
export function daneGrupy(dane, grupa) {
  const bankKonta = new Map((dane.bank_accounts ?? []).map((k) => [k.id, k.bank]));
  return {
    ...dane,
    payments: dane.payments.filter((w) => grupaWplaty(w, bankKonta) === grupa),
    tax_payments: (dane.tax_payments ?? []).filter((t) => grupaWplatyPodatku(t) === grupa),
  };
}

/** Statusy kwartału (6.5). „zero”: kwartał zakończony, ryczałt 0 zł i brak wpisanej wpłaty. */
export const STATUSY_KWARTALU = Object.freeze({
  przyszly: { tekst: 'Przyszły', klasa: 'wylaczona' },
  biezacy: { tekst: 'W trakcie', klasa: 'zajeta' },
  do_zaplaty: { tekst: 'Do zapłaty', klasa: 'czesciowo' },
  po_terminie: { tekst: 'Po terminie', klasa: 'zalega' },
  niedoplata: { tekst: 'Wpłacono za mało', klasa: 'zalega' },
  zaplacony: { tekst: 'Zapłacony', klasa: 'ok' },
  zero: { tekst: 'Nic do zapłaty', klasa: 'ok' },
});

/**
 * Zaokrąglenie do pełnych złotych (art. 63 § 1 Ordynacji podatkowej):
 * końcówki poniżej 50 groszy pomija się, od 50 groszy w górę podwyższa do pełnego złotego.
 * 12349 → 12300, 12350 → 12400; dla kwot ujemnych symetrycznie.
 */
export function doPelnychZl(gr) {
  return Math.sign(gr) * Math.round(Math.abs(gr) / 100) * 100;
}

/**
 * f(x) z punktu 6.2: ryczałt od przychodu narastającego (w groszach, bez zaokrąglenia).
 * Stawka niższa do progu, wyższa od nadwyżki ponad próg. Przychód ujemny = 0.
 */
export function ryczaltOd(przychodGr, { tax_rate_low_bp: niska, tax_rate_high_bp: wysoka, tax_threshold_gr: prog }) {
  const x = Math.max(0, przychodGr);
  return (Math.min(x, prog) * niska + Math.max(0, x - prog) * wysoka) / 10000;
}

// ---------------------------------------------------------------------
// Terminy (6.2): 20. dzień miesiąca po kwartale, za IV kwartał 20 stycznia następnego roku.
// Gdy ten dzień to sobota albo dzień ustawowo wolny, termin przesuwa się na następny dzień roboczy
// (art. 12 § 5 Ordynacji podatkowej).
// ---------------------------------------------------------------------

/** Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański). */
export function wielkanoc(rok) {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(rok, miesiac, dzien);
}

const naDate = (tekst) => new Date(`${tekst}T00:00:00Z`);
const zDaty = (d) => d.toISOString().slice(0, 10);
const plusDni = (tekst, n) => {
  const d = naDate(tekst);
  d.setUTCDate(d.getUTCDate() + n);
  return zDaty(d);
};

/** Dni ustawowo wolne od pracy w Polsce w danym roku (ustawa z 18.01.1951, z Wigilią od 2025 r.). */
export function swieta(rok) {
  const wlk = wielkanoc(rok);
  const stale = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26'];
  if (rok >= 2025) stale.push('12-24');
  return new Set([
    ...stale.map((md) => `${rok}-${md}`),
    wlk, plusDni(wlk, 1),        // Wielkanoc i Poniedziałek Wielkanocny
    plusDni(wlk, 49),            // Zielone Świątki (niedziela)
    plusDni(wlk, 60),            // Boże Ciało
  ]);
}

/** Pierwszy dzień roboczy od podanej daty włącznie (sobota, niedziela i święta przesuwają termin). */
export function dzienRoboczy(tekst) {
  let d = tekst;
  for (;;) {
    const dzienTygodnia = naDate(d).getUTCDay();
    if (dzienTygodnia !== 0 && dzienTygodnia !== 6 && !swieta(Number(d.slice(0, 4))).has(d)) return d;
    d = plusDni(d, 1);
  }
}

/** Termin wpłaty ryczałtu za kwartał q roku. */
export function terminKwartalu(rok, q) {
  return dzienRoboczy(q < 4 ? iso(rok, q * 3 + 1, 20) : iso(rok + 1, 1, 20));
}

/** Pierwszy i ostatni dzień kwartału. */
export function datyKwartalu(rok, q) {
  const ostatniMiesiac = q * 3;
  const ostatniDzien = new Date(Date.UTC(rok, ostatniMiesiac, 0)).getUTCDate();
  return { od: iso(rok, ostatniMiesiac - 2, 1), do: iso(rok, ostatniMiesiac, ostatniDzien) };
}

/** Kwartał (1–4) daty albo klucza miesiąca. */
export const kwartalDaty = (tekst) => Math.ceil(Number(tekst.slice(5, 7)) / 3);

// ---------------------------------------------------------------------
// Przychód i próg
// ---------------------------------------------------------------------

/** Wpłaty będące przychodem w roku, posortowane po dacie. */
function przychodyRoku(payments, rok) {
  return payments.filter((w) => PRZYCHOD.has(w.kind) && w.booked_on.startsWith(`${rok}-`))
    .sort((a, b) => a.booked_on.localeCompare(b.booked_on));
}

/**
 * Prognoza miesiąca przekroczenia progu: średnia z 3 ostatnich pełnych miesięcy roku (6.3).
 * Bieżący miesiąc dopełniamy do średniej, kolejne liczymy po średniej. Zwraca 'RRRR-MM' albo null.
 */
export function prognozaPrzekroczenia(wplatyRoku, { rok, dzis, progGr }) {
  if (rok !== Number(dzis.slice(0, 4))) return null;
  const biezacy = kluczMiesiaca(dzis);
  const doDzis = wplatyRoku.filter((w) => w.booked_on <= dzis);
  const wMiesiacu = (k) => doDzis.filter((w) => w.booked_on.startsWith(k)).reduce((x, w) => x + w.amount_gr, 0);
  const pelne = zakresMiesiecy(`${rok}-01`, biezacy).filter((k) => k < biezacy).slice(-3);
  if (!pelne.length) return null;
  const srednia = pelne.reduce((x, k) => x + wMiesiacu(k), 0) / pelne.length;
  if (srednia <= 0) return null;
  let suma = doDzis.reduce((x, w) => x + w.amount_gr, 0);
  for (const k of zakresMiesiecy(biezacy, `${rok}-12`)) {
    suma += k === biezacy ? Math.max(0, srednia - wMiesiacu(k)) : srednia;
    if (suma > progGr) return k;
  }
  return null;
}

/**
 * Próg wyższej stawki w roku (6.3): przychód od 1 stycznia do dziś (albo do końca roku, gdy rok minął).
 * @returns {{ sumaGr, progGr, udzial, dataPrzekroczenia: string|null, prognoza: string|null }}
 */
export function progRoku(payments, { rok, dzis, ustawienia }) {
  const progGr = ustawienia.tax_threshold_gr;
  const wplaty = przychodyRoku(payments, rok);
  let suma = 0;
  let dataPrzekroczenia = null;
  for (const w of wplaty) {
    if (w.booked_on > dzis) break;
    suma += w.amount_gr;
    if (!dataPrzekroczenia && suma > progGr) dataPrzekroczenia = w.booked_on;
  }
  // Zwroty mogą zejść z powrotem pod próg – liczy się stan na koniec, a data to pierwsze przekroczenie przy tym stanie.
  if (suma <= progGr) dataPrzekroczenia = null;
  return {
    sumaGr: suma, progGr, udzial: progGr ? suma / progGr : 0, dataPrzekroczenia,
    prognoza: dataPrzekroczenia ? null : prognozaPrzekroczenia(wplaty, { rok, dzis, progGr }),
  };
}

// ---------------------------------------------------------------------
// Zestawienie roczne (6.2, 6.5)
// ---------------------------------------------------------------------

function statusKwartalu({ od, do: koniec, termin, ryczaltGr, wplata }, dzis) {
  if (wplata) return wplata.amount_gr >= ryczaltGr || dzis <= koniec ? 'zaplacony' : 'niedoplata';
  if (dzis < od) return 'przyszly';
  if (dzis <= koniec) return 'biezacy';
  if (ryczaltGr === 0) return 'zero';
  return dzis > termin ? 'po_terminie' : 'do_zaplaty';
}

/**
 * Zestawienie roku do PIT-28.
 *
 * Kwartał: przychód kwartału zaokrąglony do pełnych zł (art. 63 § 1 OP), narastająco = suma zaokrąglonych
 * przychodów kwartałów, ryczałt R_q = zaokr(f(P_q) − f(P_q−1)). Ujemny R_q → 0 zł i flaga `ujemny`
 * (przewaga zwrotów – do sprawdzenia z księgową).
 * Rok: ryczałt roczny = zaokr(f(zaokr(przychód roku))) – może różnić się od sumy kwartałów o pojedyncze złote.
 *
 * @param {{ payments: Array, tax_payments: Array }} dane
 * @param {{ rok: number, dzis: string, ustawienia: object }} o
 */
export function zestawienieRoku({ payments, tax_payments: wplatyPodatku = [] }, { rok, dzis, ustawienia }) {
  const wplaty = przychodyRoku(payments, rok);
  const miesiace = zakresMiesiecy(`${rok}-01`, `${rok}-12`).map((klucz) => ({
    klucz,
    przychodGr: wplaty.filter((w) => w.booked_on.startsWith(klucz)).reduce((x, w) => x + w.amount_gr, 0),
  }));

  let narastajaco = 0;
  const kwartaly = [1, 2, 3, 4].map((q) => {
    const { od, do: koniec } = datyKwartalu(rok, q);
    const surowy = miesiace.slice((q - 1) * 3, q * 3).reduce((x, m) => x + m.przychodGr, 0);
    const przychodGr = doPelnychZl(surowy);
    const poprzednio = narastajaco;
    narastajaco += przychodGr;
    const wyliczony = doPelnychZl(ryczaltOd(narastajaco, ustawienia) - ryczaltOd(poprzednio, ustawienia));
    const ryczaltGr = Math.max(0, wyliczony);
    const wplata = wplatyPodatku.find((t) => t.year === rok && t.quarter === q) ?? null;
    const termin = terminKwartalu(rok, q);
    const k = { q, od, do: koniec, termin, przychodGr, narastajacoGr: narastajaco, ryczaltGr, ujemny: wyliczony < 0,
      ponadProgiem: narastajaco > ustawienia.tax_threshold_gr, wplata, wplaconoGr: wplata?.amount_gr ?? 0 };
    k.status = statusKwartalu(k, dzis);
    k.doZaplatyGr = Math.max(0, ryczaltGr - k.wplaconoGr);
    return k;
  });

  const przychodGr = doPelnychZl(wplaty.reduce((x, w) => x + w.amount_gr, 0));
  const ryczaltKwartalyGr = kwartaly.reduce((x, k) => x + k.ryczaltGr, 0);
  const ryczaltRocznyGr = doPelnychZl(ryczaltOd(przychodGr, ustawienia));
  const wplaconoGr = kwartaly.reduce((x, k) => x + k.wplaconoGr, 0);
  return {
    rok, miesiace, kwartaly,
    przychodGr, ryczaltKwartalyGr, ryczaltRocznyGr, wplaconoGr,
    roznicaGr: ryczaltRocznyGr - wplaconoGr,   // > 0: do dopłaty w PIT-28, < 0: nadpłata
  };
}

/**
 * Kwartały wymagające uwagi na pulpicie: zakończone, z ryczałtem > 0 i bez wystarczającej wpłaty.
 * Sprawdza bieżący i poprzedni rok (za IV kwartał płaci się w styczniu), ale nie lata sprzed startu danych.
 * Osobno dla każdego licznika (GRUPY_RYCZALTU).
 * @returns {Array<{ rok, q, grupa, status, termin, doZaplatyGr }>} posortowane od najstarszego
 */
export function kwartalyDoZaplaty(dane, { dzis, ustawienia }) {
  const rokDzis = Number(dzis.slice(0, 4));
  const rokStartu = Number(String(ustawienia.data_start ?? `${rokDzis}`).slice(0, 4));
  const wynik = [];
  for (const rok of [rokDzis - 1, rokDzis]) {
    if (rok < rokStartu) continue;
    for (const g of GRUPY_RYCZALTU) {
      for (const k of zestawienieRoku(daneGrupy(dane, g.id), { rok, dzis, ustawienia }).kwartaly) {
        if (['do_zaplaty', 'po_terminie', 'niedoplata'].includes(k.status)) {
          wynik.push({ rok, q: k.q, grupa: g.id, status: k.status, termin: k.termin, doZaplatyGr: k.doZaplatyGr });
        }
      }
    }
  }
  return wynik.sort((a, b) => a.rok - b.rok || a.q - b.q);
}

/**
 * Wiersze CSV zestawienia do PIT-28 (rozdz. 10): miesiące, kwartały i rok.
 * Kolumny: okres; przychód; przychód narastająco; ryczałt należny; termin; wpłacono; data wpłaty; różnica.
 * Kwoty w złotych z przecinkiem dziesiętnym, daty RRRR-MM-DD.
 */
export const NAGLOWEK_CSV = Object.freeze(['okres', 'przychod', 'przychod_narastajaco', 'ryczalt_nalezny', 'termin',
  'wplacono', 'data_wplaty', 'roznica']);

export function wierszeCsv(z) {
  const zl = (gr) => (gr / 100).toFixed(2).replace('.', ',');
  let narastajaco = 0;
  const miesiace = z.miesiace.map((m) => {
    narastajaco += m.przychodGr;
    return [m.klucz, zl(m.przychodGr), zl(narastajaco), '', '', '', '', ''];
  });
  const kwartaly = z.kwartaly.map((k) => [`${z.rok} ${etykietaKwartalu(k.q)}`, zl(k.przychodGr), zl(k.narastajacoGr),
    zl(k.ryczaltGr), k.termin, k.wplata ? zl(k.wplaconoGr) : '', k.wplata?.paid_on ?? '', zl(k.ryczaltGr - k.wplaconoGr)]);
  const rok = [`${z.rok} rok`, zl(z.przychodGr), zl(z.przychodGr), zl(z.ryczaltRocznyGr), '', zl(z.wplaconoGr), '', zl(z.roznicaGr)];
  return [...miesiace, ...kwartaly, rok];
}
