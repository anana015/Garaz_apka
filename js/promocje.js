// Promocje najmu (decyzja 12 z 10.11, prośby z 11.11 i 12.11): rabat % na N pierwszych miesięcy.
// Promocja to nie osobny mechanizm, tylko stawki w historii najmu (rental_rates):
//   [stawka 0 zł – końcówka miesiąca gratis], obniżona stawka, normalna stawka („koniec promocji”).
// Lista gotowych promocji jest w settings.promotions (migracja 007); null = lista domyślna.
//
// Reguła od 12.11.2026 (okresy miesięczne), N = liczba miesięcy promocji, dzień = dzień startu promocji:
//  - 1.–10.  bieżący miesiąc liczy się w całości jako 1. miesiąc promocji; normalna stawka od 1. dnia
//            miesiąca N miesięcy później (start 05.11, N = 2 → listopad i grudzień z rabatem, od 01.01 normalnie);
//  - 11.–22. promocja do tego samego dnia za N miesięcy włącznie, normalna stawka od następnego dnia; miesiąc
//            dzielony na części, każda do pełnych 10 zł (start 12.11 → 12.11–12.01 po 100 zł, od 13.01 po 200 zł:
//            listopad 60 zł, grudzień 100 zł, styczeń 40 + 120 = 160 zł, potem 200 zł);
//  - 23.–31. końcówka miesiąca gratis, potem N pełnych miesięcy z rabatem (start 25.11 → listopad 0 zł,
//            grudzień i styczeń po 100 zł, od 01.02 normalnie).
// Podział miesiąca robią stawki „od dnia” (rental_rates.from_day, migracja 013) – js/okresy.js.
// Okresy dłuższe niż miesiąc (kwartał, pół roku, rok): reguła z 0.13.0 – N okresów, koniec na początku okresu.
// Jednorazowy SQL supabase/jednorazowe/promocja_startowa_boxy.sql (najmy sprzed 0.19.0) zostaje przy regule z 0.13.0.

import { naleznosciNajmu, pierwszyOkresOd } from './okresy.js';
import { dodajDni, dodajMiesiace, iso, parseData } from './utils.js';

export const DOMYSLNE_PROMOCJE = Object.freeze([
  Object.freeze({ id: 'startowa', nazwa: 'Promocja startowa −50% / 2 mies.', rabat: 50, okresy: 2 }),
  Object.freeze({ id: 'pierwszy-miesiac', nazwa: 'Zniżka na pierwszy miesiąc', rabat: 50, okresy: 1 }),
]);

/** Powód stawki „normalna po promocji”. */
export const KONIEC_PROMOCJI = 'koniec promocji';
/** Dopisek powodu stawki 0 zł na końcówkę miesiąca (start od 23. dnia). */
export const GRATIS = ' – końcówka miesiąca gratis';

/** Lista promocji z ustawień albo domyślna. */
export function listaPromocji(ustawienia) {
  const lista = ustawienia?.promotions;
  return Array.isArray(lista) ? lista.filter((p) => p && p.id && p.nazwa) : [...DOMYSLNE_PROMOCJE];
}

/** „−50% przez 2 mies.” */
export const opisWarunkow = (p) => `−${String(p.rabat).replace('.', ',')}% przez ${p.okresy} mies.`;

/** Stawka promocyjna w groszach, zaokrąglona do pełnych złotych (decyzja „do potwierdzenia” z 0.4.2). */
export const stawkaPromocyjna = (normalnaGr, rabat) => Math.round((normalnaGr * (100 - rabat)) / 100 / 100) * 100;

/**
 * Rabat i liczba okresów z pól formularza. Zwraca { bledy, rabat, okresy }.
 * pola: nazwy pól z rabatem i liczbą okresów (różne w nowym najmie i w formularzu promocji).
 */
export function czytajWarunki(w, { rabat: poleRabatu = 'rabat', okresy: poleOkresow = 'okresy' } = {}) {
  const bledy = {};
  const rabat = Number(String(w[poleRabatu] ?? '').trim().replace(',', '.').replace(/%$/, ''));
  if (!(rabat > 0 && rabat < 100)) bledy[poleRabatu] = 'Rabat od 1 do 99%.';
  const okresy = Number(String(w[poleOkresow] ?? '').trim());
  if (!Number.isInteger(okresy) || okresy < 1 || okresy > 24) bledy[poleOkresow] = 'Od 1 do 24 miesięcy.';
  return { bledy, rabat, okresy };
}

/** Opis wariantu reguły dla podglądu. */
export const OPIS_WARIANTU = {
  'poczatek-miesiaca': 'start 1.–10. dnia: ten miesiąc to 1. miesiąc promocji',
  'srodek-miesiaca': 'start 11.–22. dnia: do tego samego dnia, potem proporcjonalnie (do 10 zł)',
  'koniec-miesiaca': 'start od 23. dnia: końcówka miesiąca gratis, potem pełne miesiące z rabatem',
  okresy: 'okresy dłuższe niż miesiąc: N okresów',
};

/** Reguła z 0.13.0 – dla okresów dłuższych niż miesiąc. */
function planOkresowy(najem, { promocyjnaGr, okresy, od }) {
  const poczatek = pierwszyOkresOd(najem, od);
  if (!poczatek) return null;
  const dlugosc = najem.period_months ?? 1;
  const koniec = pierwszyOkresOd(najem, dodajDni(dodajMiesiace(poczatek, okresy * dlugosc), -15));
  return { wariant: 'okresy', poczatek, gratisDo: null, promocjaOd: poczatek, koniec, promocyjnaGr, okresy };
}

/**
 * Plan promocji dla najmu od dnia `od` (domyślnie start najmu) przez `okresy` miesięcy – reguła z nagłówka pliku.
 * @returns {{ wariant, poczatek, gratisDo, promocjaOd, koniec, promocyjnaGr, okresy } | null}
 *   poczatek – pierwszy dzień promocji (także gratisowy); gratisDo – ostatni dzień gratis (albo null);
 *   promocjaOd – pierwszy dzień z rabatem; koniec – pierwszy dzień normalnej stawki (null – najem kończy się wcześniej);
 *   null – najem kończy się przed `od`.
 */
export function planPromocji(najem, { normalnaGr, rabat, okresy, od = najem.start_on }) {
  if (!parseData(od)) return null;
  const odDnia = od < najem.start_on ? najem.start_on : od;
  if (najem.end_on != null && odDnia > najem.end_on) return null;
  const promocyjnaGr = stawkaPromocyjna(normalnaGr, rabat);
  if ((najem.period_months ?? 1) !== 1) return planOkresowy(najem, { promocyjnaGr, okresy, od: odDnia });

  const p = parseData(odDnia);
  const pierwszy = iso(p.y, p.m, 1);
  let plan;
  if (p.d <= 10) {
    const poczatek = pierwszy < najem.start_on ? najem.start_on : pierwszy;
    plan = { wariant: 'poczatek-miesiaca', poczatek, gratisDo: null, promocjaOd: poczatek, koniec: dodajMiesiace(pierwszy, okresy) };
  } else if (p.d <= 22) {
    plan = { wariant: 'srodek-miesiaca', poczatek: odDnia, gratisDo: null, promocjaOd: odDnia,
      koniec: dodajDni(dodajMiesiace(odDnia, okresy), 1) };
  } else {
    const nastepny = dodajMiesiace(pierwszy, 1);
    plan = { wariant: 'koniec-miesiaca', poczatek: odDnia, gratisDo: dodajDni(nastepny, -1), promocjaOd: nastepny,
      koniec: dodajMiesiace(pierwszy, okresy + 1) };
  }
  const poKoncu = (d) => najem.end_on != null && d > najem.end_on;
  return { ...plan, promocjaOd: poKoncu(plan.promocjaOd) ? null : plan.promocjaOd,
    koniec: poKoncu(plan.koniec) ? null : plan.koniec, promocyjnaGr, okresy };
}

/**
 * Wiersze rental_rates promocji: [0 zł do końca miesiąca], obniżona stawka, normalna od końca promocji.
 * from_day = stawka od swojego dnia (dzieli miesiąc); zawsze podane, żeby nadpisanie stawki z tą samą datą było pewne.
 */
export function wierszeStawek(najemId, plan, normalnaGr, powod) {
  const odDnia = (d) => plan.wariant !== 'okresy' && parseData(d).d !== 1;
  const wiersze = [];
  if (plan.gratisDo) {
    wiersze.push({ rental_id: najemId, valid_from: plan.poczatek, amount_gr: 0, reason: `${powod}${GRATIS}`, from_day: true });
  }
  if (plan.promocjaOd) {
    wiersze.push({ rental_id: najemId, valid_from: plan.promocjaOd, amount_gr: plan.promocyjnaGr, reason: powod,
      from_day: odDnia(plan.promocjaOd) });
  }
  if (plan.koniec) {
    wiersze.push({ rental_id: najemId, valid_from: plan.koniec, amount_gr: normalnaGr, reason: KONIEC_PROMOCJI,
      from_day: odDnia(plan.koniec) });
  }
  return wiersze;
}

/** Wiersze wymagają migracji 013 (stawka „od dnia” albo 0 zł). */
export const wymagajaMigracji013 = (wiersze) => wiersze.some((w) => w.from_day || w.amount_gr === 0);

/** Baza ma kolumnę from_day (migracja 013): rozpoznane po pobranych stawkach; bez stawek – nie wiadomo, więc tak. */
export const jestMigracja013 = (stawki = []) => !stawki.length || stawki.some((st) => 'from_day' in st);

/**
 * Kwoty w kolejnych miesiącach promocji – do podglądu przed zapisem:
 * [{ poczatek, koniec, kwotaGr, czesci }] od miesiąca startu promocji do pierwszego pełnego miesiąca po niej.
 * stawki – obecne stawki najmu (te sprzed promocji zostają, te od jej początku zastąpi promocja).
 */
export function harmonogramPromocji(najem, { plan, normalnaGr, powod = 'promocja', stawki = [] }) {
  if (!plan) return [];
  const nowe = wierszeStawek(najem.id, plan, normalnaGr, powod);
  const wszystkie = [...stawki.filter((st) => st.valid_from < plan.poczatek), ...nowe];
  const p = parseData(plan.poczatek);
  const odMiesiaca = iso(p.y, p.m, 1);
  const koniec = plan.koniec ?? najem.end_on ?? dodajMiesiace(odMiesiaca, plan.okresy + 1);
  const k = parseData(koniec);
  // Do miesiąca, w którym zaczyna się normalna stawka; gdy zaczyna się 1. dnia – ten miesiąc też (pokazuje pełną kwotę).
  const doMiesiaca = iso(k.y, k.m, 1);
  return naleznosciNajmu({ ...najem, id: najem.id ?? 'nowy' }, {
    stawki: wszystkie, dataStart: najem.start_on, dzis: najem.start_on,
    horyzontMiesiecy: Math.max(3, (plan.okresy ?? 1) * (najem.period_months ?? 1) + 14),
  }).filter((n) => n.poczatek >= (odMiesiaca < najem.start_on ? najem.start_on : odMiesiaca) && n.poczatek <= doMiesiaca)
    .map(({ poczatek, koniec: kon, kwotaGr, czesci, stawkaGr }) => ({ poczatek, koniec: kon, kwotaGr, czesci, stawkaGr }));
}

/** Nowa pozycja listy promocji (z formularza „Inna”). id unikalne w liście. */
export function nowaPozycja(lista, { nazwa, rabat, okresy }) {
  const tekst = String(nazwa ?? '').trim() || `Promocja ${opisWarunkow({ rabat, okresy })}`;
  const baza = tekst.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'promocja';
  let id = baza;
  for (let i = 2; lista.some((p) => p.id === id); i++) id = `${baza}-${i}`;
  return { id, nazwa: tekst.slice(0, 60), rabat, okresy };
}

// ---------------------------------------------------------------------
// Rozpoznawanie promocji i podwyżek w historii stawek (znaczniki, ekran „Promocje i podwyżki”, umowy)
// ---------------------------------------------------------------------

const posortuj = (stawki) => [...stawki].sort((a, b) => a.valid_from.localeCompare(b.valid_from));

/**
 * Wszystkie promocje w historii stawek najmu (także zakończone), od najstarszej:
 * [{ od, do, nazwa, promocyjnaGr, regularnaGr, gratisDo, wiersze }]; do = ostatni dzień promocji (null – bez końca).
 * Promocja = stawka tańsza od następnej stawki „koniec promocji” (z ewentualną stawką 0 zł przed nią),
 * albo – w starszych zapisach – stawka z powodem zaczynającym się od „promocja”.
 */
export function promocjeNajmu(stawki = []) {
  const st = posortuj(stawki);
  const wynik = [];
  const uzyte = new Set();
  st.forEach((k, j) => {
    if (k.reason !== KONIEC_PROMOCJI || j === 0) return;
    const glowna = st[j - 1];
    if (!(glowna.amount_gr < k.amount_gr) || glowna.reason === KONIEC_PROMOCJI) return;
    const wiersze = [glowna];
    const przed = st[j - 2];
    if (przed && przed.amount_gr === 0 && przed.reason !== KONIEC_PROMOCJI && glowna.amount_gr > 0) wiersze.unshift(przed);
    wiersze.forEach((w) => uzyte.add(w));
    wynik.push({
      od: wiersze[0].valid_from, do: dodajDni(k.valid_from, -1), nazwa: glowna.reason || 'promocja',
      promocyjnaGr: glowna.amount_gr, regularnaGr: k.amount_gr,
      gratisDo: wiersze.length > 1 ? dodajDni(glowna.valid_from, -1) : null, wiersze,
    });
  });
  st.forEach((w, i) => {
    if (uzyte.has(w) || w.reason === KONIEC_PROMOCJI || !/^promocja/i.test(w.reason ?? '')) return;
    const nastepna = st[i + 1];
    uzyte.add(w);
    wynik.push({ od: w.valid_from, do: nastepna ? dodajDni(nastepna.valid_from, -1) : null, nazwa: w.reason,
      promocyjnaGr: w.amount_gr, regularnaGr: nastepna?.amount_gr ?? null, gratisDo: null, wiersze: [w] });
  });
  return wynik.sort((a, b) => a.od.localeCompare(b.od));
}

/**
 * Trwająca promocja najmu w dniu `dzien` (znacznik „promocja do …”).
 * @returns {{ od, do: string|null, nazwa } | null} do – ostatni dzień promocji (null – do końca najmu)
 */
export function promocjaNajmu(stawki = [], dzien) {
  const p = promocjeNajmu(stawki).find((x) => x.od <= dzien && (x.do == null || x.do >= dzien));
  return p ? { od: p.od, do: p.do, nazwa: p.nazwa } : null;
}

/**
 * Podwyżki w historii stawek najmu: [{ od, zGr, naGr, powod }] – stawka wyższa od poprzedniej normalnej stawki.
 * Stawki promocji i powrót do normalnej stawki po promocji („koniec promocji”) nie są podwyżką.
 */
export function podwyzkiNajmu(stawki = []) {
  const promocyjne = new Set(promocjeNajmu(stawki).flatMap((p) => p.wiersze));
  const wynik = [];
  let poprzednia = null;
  for (const st of posortuj(stawki)) {
    if (promocyjne.has(st)) continue;
    if (poprzednia != null && st.reason !== KONIEC_PROMOCJI && st.amount_gr > poprzednia) {
      wynik.push({ od: st.valid_from, zGr: poprzednia, naGr: st.amount_gr, powod: st.reason ?? '' });
    }
    poprzednia = st.amount_gr;
  }
  return wynik;
}

/**
 * Zestawienie do ekranu „Promocje i podwyżki” (prośba 12.11): kto korzysta / korzystał z promocji, kto miał podwyżkę
 * i kiedy, ręczne zmiany kwot w miesiącach (charge_adjustments).
 * @param {{ rentals, rental_rates, charge_adjustments }} dane
 * @param {{ umowy: Map, klienci: Map, jednostki: Map, stawkiNajmu: Map }} indeksy
 * @returns {{ promocje: Array, podwyzki: Array, zmianyKwot: Array }}
 *   promocje: { najem, klient, jednostka, nazwa, od, do, gratisDo, promocyjnaGr, regularnaGr,
 *     status: 'trwa' | 'zaplanowana' | 'zakonczona' | 'przerwana' } (przerwana – najem skończył się w trakcie promocji)
 *   podwyzki: { najem, klient, jednostka, od, zGr, naGr, powod, zaplanowana }
 *   zmianyKwot: { najem, klient, jednostka, okres, kwotaGr, powod, id }
 */
export function zestawienieStawek(dane, indeksy, dzien) {
  const promocje = [];
  const podwyzki = [];
  const kontekst = (najem) => {
    const umowa = indeksy.umowy.get(najem.contract_id);
    return { najem, klient: umowa ? indeksy.klienci.get(umowa.client_id) ?? null : null, jednostka: indeksy.jednostki.get(najem.unit_id) ?? null };
  };
  for (const najem of dane.rentals) {
    const stawki = indeksy.stawkiNajmu.get(najem.id) ?? [];
    if (!stawki.length) continue;
    const k = kontekst(najem);
    for (const p of promocjeNajmu(stawki)) {
      const koniec = p.do && najem.end_on && najem.end_on < p.do ? najem.end_on : p.do ?? najem.end_on ?? null;
      let status;
      if (p.od > dzien) status = 'zaplanowana';
      else if (najem.end_on && p.do && najem.end_on < p.do) status = najem.end_on < dzien ? 'przerwana' : 'trwa';
      else status = koniec && koniec < dzien ? 'zakonczona' : 'trwa';
      promocje.push({ ...k, nazwa: p.nazwa, od: p.od, do: koniec, gratisDo: p.gratisDo, promocyjnaGr: p.promocyjnaGr,
        regularnaGr: p.regularnaGr, status });
    }
    for (const x of podwyzkiNajmu(stawki)) podwyzki.push({ ...k, ...x, zaplanowana: x.od > dzien });
  }
  const najmy = new Map(dane.rentals.map((n) => [n.id, n]));
  const zmianyKwot = (dane.charge_adjustments ?? []).filter((a) => najmy.has(a.rental_id)).map((a) => ({
    ...kontekst(najmy.get(a.rental_id)), okres: a.period_start, kwotaGr: a.amount_gr, powod: a.reason ?? '', id: a.id,
  }));
  return {
    promocje: promocje.sort((a, b) => b.od.localeCompare(a.od)),
    podwyzki: podwyzki.sort((a, b) => b.od.localeCompare(a.od)),
    zmianyKwot: zmianyKwot.sort((a, b) => b.okres.localeCompare(a.okres)),
  };
}
