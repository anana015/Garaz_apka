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

// ---------------------------------------------------------------------
// Brakujące wpłaty – tabela miesięcy (5.6, karta 4 w rozdz. 9)
// ---------------------------------------------------------------------

/**
 * Dla każdego miesiąca: klienci z należnością z terminem w tym miesiącu (oczekiwane przelewy) podzieleni na
 * zapłacone w terminie (wszystko do terminu + tolerancja), spóźnione (zapłacone później) i brakujące (coś nieopłacone).
 * Liczymy klientów, nie należności – klient z dwiema jednostkami robi zwykle jeden przelew.
 * @param {Map} rozliczenia wynik rozliczenia.rozliczenia(): clientId → { pozycje }
 * @param {string[]} miesiace klucze 'RRRR-MM' (miesiące po bieżącym są pomijane)
 * @returns {Array<{klucz, oczekiwane, terminowo, spoznione, brakujace, przedTerminem, brakGr, naleznoGr, pokryteGr, sciagalnosc}>}
 */
export function brakujaceWplatyMiesiecy(rozliczenia, miesiace, { dzis, tolerancja = 0 }) {
  const biezacy = kluczMiesiaca(dzis);
  const wynik = new Map(miesiace.filter((k) => k <= biezacy).map((k) => [k, {
    klucz: k, oczekiwane: 0, terminowo: 0, spoznione: 0, brakujace: 0, przedTerminem: 0, brakGr: 0, naleznoGr: 0, pokryteGr: 0,
  }]));
  for (const r of rozliczenia.values()) {
    const wgMiesiaca = new Map();
    for (const p of r.pozycje) {
      if (p.otwarcie || !p.kwotaGr) continue;
      const k = kluczMiesiaca(p.termin);
      if (!wynik.has(k)) continue;
      if (!wgMiesiaca.has(k)) wgMiesiaca.set(k, []);
      wgMiesiaca.get(k).push(p);
    }
    for (const [k, poz] of wgMiesiaca) {
      const m = wynik.get(k);
      m.oczekiwane += 1;
      m.naleznoGr += poz.reduce((x, p) => x + p.kwotaGr, 0);
      m.pokryteGr += poz.reduce((x, p) => x + Math.min(p.zaplaconoGr, p.kwotaGr), 0);
      const niezaplacone = poz.filter((p) => p.zaplaconoGr < p.kwotaGr);
      if (niezaplacone.length) {
        m.brakujace += 1;
        m.brakGr += niezaplacone.reduce((x, p) => x + p.kwotaGr - p.zaplaconoGr, 0);
        if (niezaplacone.every((p) => p.termin >= dzis)) m.przedTerminem += 1;
      } else if (poz.every((p) => !p.zaplaconoDnia || roznicaDni(p.termin, p.zaplaconoDnia) <= tolerancja)) {
        m.terminowo += 1;
      } else m.spoznione += 1;
    }
  }
  return [...wynik.values()].map((m) => ({ ...m, sciagalnosc: m.naleznoGr ? m.pokryteGr / m.naleznoGr : null }));
}

// ---------------------------------------------------------------------
// Porównanie lat (karta 8 w rozdz. 9)
// ---------------------------------------------------------------------

const ostatniDzienMiesiaca = (klucz) => {
  const [y, m] = klucz.split('-').map(Number);
  return `${klucz}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Lata do porównania: od roku najstarszej wpłaty albo daty startu danych do bieżącego roku. */
export function lataDanych(dane, { dataStart, dzis }) {
  let od = Number(dataStart.slice(0, 4));
  for (const w of dane.payments) od = Math.min(od, Number(w.booked_on.slice(0, 4)));
  for (const n of dane.rentals) od = Math.min(od, Number(n.start_on.slice(0, 4)));
  const doRoku = Number(dzis.slice(0, 4));
  const lata = [];
  for (let r = Math.max(od, doRoku - 9); r <= doRoku; r++) lata.push(r);
  return lata;
}

/**
 * Wskaźniki roku: przychód kasowy, średnio na miesiąc, ściągalność, terminowość, obłożenie (średnia z końców miesięcy),
 * koszty i zysk. Bieżący rok – do dziś. Należności liczą się od daty startu danych, więc dla lat wcześniejszych
 * ściągalność i terminowość są puste (null), dopóki data startu nie zostanie przesunięta.
 * @param {object} dane state.dane
 * @param {Map} rozliczenia clientId → { pozycje }
 * @param {{ lata: number[], dzis, tolerancja, zysk: (od, do) => {kosztyGr, ryczaltGr, zyskGr} }} o
 */
export function porownanieLat(dane, rozliczenia, { lata, dzis, tolerancja = 0, zysk }) {
  const pozycje = [...rozliczenia.values()].flatMap((r) => r.pozycje).filter((p) => !p.otwarcie && p.kwotaGr);
  const jednostki = dane.units.filter((j) => !j.archived && !j.out_of_service);
  const idJednostek = new Set(jednostki.map((j) => j.id));
  const najmy = dane.rentals.filter((n) => idJednostek.has(n.unit_id));
  const pierwszaWplata = dane.payments.reduce((m, w) => (PRZYCHOD.has(w.kind) && (!m || w.booked_on < m) ? w.booked_on : m), null);

  return lata.map((rok) => {
    const od = `${rok}-01-01`;
    const doDnia = `${rok}-12-31` < dzis ? `${rok}-12-31` : dzis;
    const przychodGr = przychodKasowy(dane.payments, od, doDnia);
    // Miesiące z danymi: od pierwszej wpłaty (gdy wypada w tym roku) do grudnia albo bieżącego miesiąca.
    const odMiesiaca = pierwszaWplata && pierwszaWplata > od ? kluczMiesiaca(pierwszaWplata) : `${rok}-01`;
    const miesiace = odMiesiaca <= kluczMiesiaca(doDnia) ? zakresMiesiecy(odMiesiaca, kluczMiesiaca(doDnia)) : [];

    const wRoku = pozycje.filter((p) => p.termin >= od && p.termin <= doDnia);
    const naleznoGr = wRoku.reduce((x, p) => x + p.kwotaGr, 0);
    const pokryteGr = wRoku.reduce((x, p) => x + Math.min(p.zaplaconoGr, p.kwotaGr), 0);
    let ocenione = 0;
    let terminowe = 0;
    for (const p of wRoku) {
      const zaplacona = p.zaplaconoGr >= p.kwotaGr && p.zaplaconoDnia;
      if (!zaplacona && roznicaDni(p.termin, dzis) <= tolerancja) continue;   // jeszcze w tolerancji
      ocenione += 1;
      if (zaplacona && roznicaDni(p.termin, p.zaplaconoDnia) <= tolerancja) terminowe += 1;
    }

    const stany = zakresMiesiecy(`${rok}-01`, kluczMiesiaca(doDnia)).map((k) => {
      const d = ostatniDzienMiesiaca(k) < dzis ? ostatniDzienMiesiaca(k) : dzis;
      return najmy.filter((n) => n.start_on <= d && (n.end_on == null || n.end_on >= d)).length;
    });
    const oblozenie = jednostki.length && najmy.some((n) => n.start_on <= doDnia && (n.end_on == null || n.end_on >= od))
      ? stany.reduce((x, z) => x + z, 0) / stany.length / jednostki.length : null;

    const z = zysk ? zysk(od, doDnia) : null;
    return {
      rok, czesciowy: doDnia < `${rok}-12-31`, doDnia, miesiecy: miesiace.length,
      przychodGr, srednioGr: miesiace.length ? Math.round(przychodGr / miesiace.length) : null,
      naleznoGr, sciagalnosc: naleznoGr ? pokryteGr / naleznoGr : null,
      terminowosc: ocenione ? terminowe / ocenione : null,
      oblozenie,
      kosztyGr: z?.kosztyGr ?? null, ryczaltGr: z?.ryczaltGr ?? null, zyskGr: z?.zyskGr ?? null,
    };
  });
}
