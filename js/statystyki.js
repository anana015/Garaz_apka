// Statystyki do Raportów i Pulpitu (rozdz. 5.7, 6.4, 9). Czyste funkcje.

import { kluczMiesiaca, zakresMiesiecy, roznicaDni } from './utils.js';

/** Grupy limitu VAT (decyzja 10.11.2026): osobno konto Millennium, osobno pozostałe konta. Gotówka się nie liczy. */
export const GRUPY_VAT = Object.freeze([
  { id: 'millennium', nazwa: 'Konto Millennium', pasuje: (bank) => bank === 'millennium' },
  { id: 'pozostale', nazwa: 'Pozostałe konta (Nest, PKO BP, Alior…)', pasuje: (bank) => bank !== 'millennium' },
]);
export const PROGI_VAT = Object.freeze([0.8, 0.95]);

const PRZYCHOD = new Set(['czynsz', 'przychod_inny']);

/** Zakres dat okresu raportu. okres: miesiac | kwartal | rok | 12m; miesiac = 'RRRR-MM' z wyboru. */
export function zakresOkresu(okres, miesiac, dzis) {
  const [y, m] = miesiac.split('-').map(Number);
  const ostatni = (rr, mm) => new Date(Date.UTC(rr, mm, 0)).getUTCDate();
  const mm = (n) => String(n).padStart(2, '0');
  if (okres === 'kwartal') {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    return { od: `${y}-${mm(q0)}-01`, do: `${y}-${mm(q0 + 2)}-${ostatni(y, q0 + 2)}`, tytul: `${Math.ceil(m / 3)}. kwartał ${y}` };
  }
  if (okres === 'rok') return { od: `${y}-01-01`, do: `${y}-12-31`, tytul: `Rok ${y}` };
  if (okres === '12m') {
    const d = new Date(Date.UTC(Number(dzis.slice(0, 4)), Number(dzis.slice(5, 7)) - 12, 1));
    return { od: `${d.getUTCFullYear()}-${mm(d.getUTCMonth() + 1)}-01`, do: dzis, tytul: 'Ostatnie 12 miesięcy' };
  }
  return { od: `${miesiac}-01`, do: `${miesiac}-${ostatni(y, m)}`, tytul: null };
}

/** Przychód kasowy (5.7): wpłaty czynsz + przychod_inny w zakresie dat (z gotówką i nieprzypisanymi). */
export function przychodKasowy(wplaty, od, doDnia) {
  return wplaty.filter((w) => PRZYCHOD.has(w.kind) && w.booked_on >= od && w.booked_on <= doDnia)
    .reduce((x, w) => x + w.amount_gr, 0);
}

/** Przychód według miesięcy zakresu: [{ klucz, wplynelo, gotowka }]. */
export function przychodMiesiecznie(wplaty, od, doDnia) {
  const miesiace = zakresMiesiecy(kluczMiesiaca(od), kluczMiesiaca(doDnia));
  const mapa = new Map(miesiace.map((k) => [k, { klucz: k, wplynelo: 0, gotowka: 0 }]));
  for (const w of wplaty) {
    if (!PRZYCHOD.has(w.kind) || w.booked_on < od || w.booked_on > doDnia) continue;
    const m = mapa.get(kluczMiesiaca(w.booked_on));
    if (!m) continue;
    m.wplynelo += w.amount_gr;
    if (w.method === 'gotowka') m.gotowka += w.amount_gr;
  }
  return [...mapa.values()];
}

/**
 * Limity zwolnienia z VAT w roku (6.4, decyzja 10.11.2026): osobno dla każdej grupy kont, tylko przelewy.
 * @returns {Array<{id, nazwa, sumaGr, limitGr, udzial, przekroczono, dataPrzekroczenia, prognoza}>}
 *   prognoza = 'RRRR-MM' miesiąca przekroczenia przy średniej z 3 ostatnich pełnych miesięcy, albo null.
 */
export function limityVat({ payments, bank_accounts: konta }, { rok, dzis, limitGr }) {
  const bankKonta = new Map(konta.map((k) => [k.id, k.bank]));
  const od = `${rok}-01-01`;
  const doDnia = `${rok}-12-31`;
  return GRUPY_VAT.map((g) => {
    const wplaty = payments
      .filter((w) => PRZYCHOD.has(w.kind) && w.method === 'przelew' && w.booked_on >= od && w.booked_on <= doDnia
        && w.bank_account_id && g.pasuje(bankKonta.get(w.bank_account_id)))
      .sort((a, b) => a.booked_on.localeCompare(b.booked_on));
    let suma = 0;
    let dataPrzekroczenia = null;
    for (const w of wplaty) {
      suma += w.amount_gr;
      if (!dataPrzekroczenia && suma > limitGr) dataPrzekroczenia = w.booked_on;
    }
    // Prognoza: średnia z 3 ostatnich pełnych miesięcy roku.
    let prognoza = null;
    if (!dataPrzekroczenia && rok === Number(dzis.slice(0, 4))) {
      const biezacy = kluczMiesiaca(dzis);
      const pelne = zakresMiesiecy(`${rok}-01`, biezacy).filter((k) => k < biezacy).slice(-3);
      if (pelne.length) {
        const srednia = pelne.reduce((x, k) => x + wplaty.filter((w) => w.booked_on.startsWith(k))
          .reduce((y, w) => y + w.amount_gr, 0), 0) / pelne.length;
        if (srednia > 0) {
          let ile = suma;
          for (const k of zakresMiesiecy(biezacy, `${rok}-12`)) {
            ile += k === biezacy ? Math.max(0, srednia - wplaty.filter((w) => w.booked_on.startsWith(k))
              .reduce((y, w) => y + w.amount_gr, 0)) : srednia;
            if (ile > limitGr) { prognoza = k; break; }
          }
        }
      }
    }
    return { id: g.id, nazwa: g.nazwa, sumaGr: suma, limitGr, udzial: suma / limitGr,
      przekroczono: Boolean(dataPrzekroczenia), dataPrzekroczenia, prognoza };
  });
}

/** Wiekowanie zaległości (5.4): sumy niezapłaconych należności w przedziałach dni po terminie. */
export function wiekowanie(rozliczenia, dzis) {
  const przedzialy = [
    { tekst: '1–30 dni', do: 30, gr: 0 }, { tekst: '31–60 dni', do: 60, gr: 0 },
    { tekst: '61–90 dni', do: 90, gr: 0 }, { tekst: 'ponad 90 dni', do: Infinity, gr: 0 },
  ];
  for (const r of rozliczenia.values()) {
    for (const p of r.pozycje) {
      if (p.termin >= dzis || p.zaplaconoGr >= p.kwotaGr) continue;
      const dni = roznicaDni(p.termin, dzis);
      przedzialy.find((x) => dni <= x.do).gr += p.kwotaGr - p.zaplaconoGr;
    }
  }
  return przedzialy;
}
