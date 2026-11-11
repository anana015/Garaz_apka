// Okresy rozliczeniowe i należności z najmów (specyfikacja 5.1).
// Czyste funkcje: dostają wiersze z bazy, zwracają należności. Nic nie zapisują (Z38).
// Testy: tests/okresy.test.js (testy akceptacyjne 1–3).
//
// Zasady:
//  - Z4  (zmiana 11.11.2026) okresy to miesiące kalendarzowe (od 1. dnia), a termin to dzień płatności
//        (billing_day, wszyscy 20.) w pierwszym miesiącu okresu – płatność z góry za cały bieżący miesiąc;
//        w niepełnym pierwszym okresie termin nie wcześniej niż start najmu;
//  - Z5  dzień płatności 29–31 w krótszym miesiącu → ostatni dzień miesiąca;
//  - Z6  okres 1, 3, 6 albo 12 miesięcy;
//  - Z7  start w inny dzień niż 1. → pierwszy okres niepełny, od startu do końca miesiąca; kwota = stawka × dni ÷ dni pełnego okresu kończącego się
//        tego samego dnia, zaokrąglona do pełnego złotego (decyzja z 9.11.2026);
//  - Z8  okres przerwany końcem najmu: proporcjonalnie do dni, do pełnego złotego, albo pełna kwota;
//  - Z13 stawka z największym valid_from nie późniejszym niż początek okresu;
//  - Z34 należności od data_start; okres zaczęty przed data_start jest w saldzie otwarcia
//        (decyzja z 9.11.2026), więc pierwsza należność ma termin ≥ data_start;
//  - 5.1 bez daty końca – okresy do dziś + 24 miesiące (przyszłe służą do rozliczania przedpłat).

import { stawkaNaDzien } from './dane.js';
import { dodajDni, dodajMiesiace, dniWMiesiacu, iso, parseData, roznicaDni } from './utils.js';

export const HORYZONT_MIESIECY = 24;
const DLUGOSCI_OKRESU = [1, 3, 6, 12];
/** Dzień, od którego liczą się okresy (miesiąc kalendarzowy). Dzień płatności z najmu to tylko termin. */
export const POCZATEK_OKRESU = 1;

/** Termin należności okresu: dzień płatności w miesiącu początku okresu, nie wcześniej niż początek (Z4). */
export function terminOkresu(poczatek, dzienPlatnosci) {
  const p = parseData(poczatek);
  const termin = iso(p.y, p.m, Math.min(dzienPlatnosci, dniWMiesiacu(p.y, p.m)));
  return termin < poczatek ? poczatek : termin;
}

/** Liczba dni od a do b włącznie. */
const dniWlacznie = (a, b) => roznicaDni(a, b) + 1;

/** Zaokrąglenie kwoty w groszach do pełnego złotego (Z7, Z8): 17 649 gr → 17 600 gr, 21 290 gr → 21 300 gr. */
export const doPelnychZlotych = (gr) => Math.round(gr / 100) * 100;

/**
 * Pierwszy dzień płatności nie wcześniejszy niż `data` (Z5).
 * pierwszyDzienPlatnosci('2026-03-10', 1) → '2026-04-01'; ('2027-02-28', 31) → '2027-02-28'
 */
export function pierwszyDzienPlatnosci(data, dzienPlatnosci) {
  const p = parseData(data);
  if (!p) throw new RangeError(`Nieprawidłowa data: ${data}`);
  const wTymMiesiacu = iso(p.y, p.m, Math.min(dzienPlatnosci, dniWMiesiacu(p.y, p.m)));
  return wTymMiesiacu >= data ? wTymMiesiacu : dodajMiesiace(wTymMiesiacu, 1, dzienPlatnosci);
}

function sprawdzNajem(najem) {
  const { start_on: start, end_on: koniec, billing_day: dzien } = najem;
  const dlugosc = najem.period_months ?? 1;
  if (!parseData(start)) throw new RangeError(`Najem ${najem.id}: nieprawidłowa data startu ${start}`);
  if (koniec != null && (!parseData(koniec) || koniec < start)) {
    throw new RangeError(`Najem ${najem.id}: nieprawidłowa data końca ${koniec}`);
  }
  if (!Number.isInteger(dzien) || dzien < 1 || dzien > 31) {
    throw new RangeError(`Najem ${najem.id}: dzień płatności ${dzien} spoza 1–31`);
  }
  if (!DLUGOSCI_OKRESU.includes(dlugosc)) {
    throw new RangeError(`Najem ${najem.id}: okres ${dlugosc} mies. spoza 1, 3, 6, 12`);
  }
  return dlugosc;
}

/**
 * Granice okresów najmu: [{ poczatek, koniec, pelnyOd }], od startu do `granica` (włącznie z okresem,
 * który zaczyna się w dniu granicy). pelnyOd to początek pełnego okresu kończącego się tego samego
 * dnia – potrzebny do proporcji niepełnego pierwszego okresu (Z7).
 */
function granice(najem, dlugosc, granica) {
  const { start_on: start } = najem;
  const dzien = POCZATEK_OKRESU;
  const okresy = [];
  if (start > granica) return okresy;

  // Początek pierwszego pełnego okresu. Każdy kolejny liczony od niego, a nie od poprzedniego,
  // żeby dzień 31 wracał po lutym: 31.01 → 28.02 → 31.03 (Z5).
  const kotwica = pierwszyDzienPlatnosci(start, dzien);
  if (kotwica > start) {
    okresy.push({ poczatek: start, koniec: dodajDni(kotwica, -1), pelnyOd: dodajMiesiace(kotwica, -dlugosc, dzien) });
  }
  for (let k = 0; ; k++) {
    const poczatek = dodajMiesiace(kotwica, k * dlugosc, dzien);
    if (poczatek > granica) break;
    okresy.push({ poczatek, koniec: dodajDni(dodajMiesiace(kotwica, (k + 1) * dlugosc, dzien), -1), pelnyOd: poczatek });
  }
  return okresy;
}

/**
 * Należności jednego najmu.
 * @param {object} najem wiersz rentals
 * @param {object} opcje
 * @param {Array} [opcje.stawki] wiersze rental_rates tego najmu
 * @param {Array} [opcje.korekty] wiersze charge_adjustments tego najmu
 * @param {string} opcje.dataStart settings.data_start (RRRR-MM-DD)
 * @param {string} opcje.dzis dzisiejsza data (RRRR-MM-DD) – horyzont dla najmów bez końca
 * @returns {Array<{najemId, jednostkaId, poczatek, koniec, termin, rodzaj, dni, dniOkresu,
 *   stawkaGr, korektaGr, kwotaGr, brakStawki}>} rodzaj: 'pelny' | 'pierwszy-niepelny' | 'ostatni-niepelny'
 */
export function naleznosciNajmu(najem, { stawki = [], korekty = [], dataStart, dzis, horyzontMiesiecy = HORYZONT_MIESIECY }) {
  if (!parseData(dataStart) || !parseData(dzis)) throw new RangeError('Brak data_start albo dzisiejszej daty');
  const dlugosc = sprawdzNajem(najem);
  const koniecNajmu = najem.end_on ?? null;
  const granica = koniecNajmu ?? dodajMiesiace(dzis, horyzontMiesiecy);

  const wynik = [];
  for (const okres of granice(najem, dlugosc, granica)) {
    if (okres.poczatek < dataStart) continue;   // w saldzie otwarcia (Z34)

    const stawka = stawkaNaDzien(stawki, okres.poczatek);
    const pelnaKwota = (stawka ?? 0) * dlugosc;
    const dniOkresu = dniWlacznie(okres.pelnyOd, okres.koniec);
    let dni = dniWlacznie(okres.poczatek, okres.koniec);
    let rodzaj = dni < dniOkresu ? 'pierwszy-niepelny' : 'pelny';
    let kwota = rodzaj === 'pelny' ? pelnaKwota : doPelnychZlotych((pelnaKwota * dni) / dniOkresu);

    if (koniecNajmu && koniecNajmu < okres.koniec) {   // Z8
      dni = dniWlacznie(okres.poczatek, koniecNajmu);
      rodzaj = 'ostatni-niepelny';
      if (najem.last_period !== 'pelny') kwota = doPelnychZlotych((pelnaKwota * dni) / dniOkresu);
    }

    const korekta = korekty
      .filter((k) => k.period_start >= okres.poczatek && k.period_start <= okres.koniec)
      .reduce((suma, k) => suma + k.amount_gr, 0);

    wynik.push({
      najemId: najem.id,
      jednostkaId: najem.unit_id,
      poczatek: okres.poczatek,
      koniec: koniecNajmu && koniecNajmu < okres.koniec ? koniecNajmu : okres.koniec,
      termin: terminOkresu(okres.poczatek, najem.billing_day),   // Z4
      rodzaj,
      dni,
      dniOkresu,
      stawkaGr: stawka,
      bazowaGr: kwota,                              // przed korektami (formularz korekty, 8.6)
      korektaGr: korekta,
      kwotaGr: Math.max(0, kwota + korekta),        // wynik nie może być ujemny (5.1)
      brakStawki: stawka == null,
    });
  }
  return wynik;
}

/**
 * Początek pierwszego okresu najmu, który zaczyna się w dniu `data` lub później (Z13: od niego
 * obowiązuje nowa stawka). null, gdy najem kończy się wcześniej.
 * pierwszyOkresOd({ start_on: '2026-03-15', billing_day: 20, … }, '2026-07-02') → '2026-08-01'
 */
export function pierwszyOkresOd(najem, data) {
  const dlugosc = sprawdzNajem(najem);
  if (!parseData(data)) throw new RangeError(`Nieprawidłowa data: ${data}`);
  const granica = dodajMiesiace(data < najem.start_on ? najem.start_on : data, dlugosc);
  const okres = granice(najem, dlugosc, granica).find((o) => o.poczatek >= data);
  if (!okres || (najem.end_on != null && okres.poczatek > najem.end_on)) return null;
  return okres.poczatek;
}

/**
 * Należności wszystkich najmów. Stawki i korekty grupowane raz, a nie filtrowane dla każdego najmu.
 * @param {{rentals: Array, rental_rates: Array, charge_adjustments: Array}} dane
 * @param {{dataStart: string, dzis: string, horyzontMiesiecy?: number}} opcje
 */
export function wszystkieNaleznosci(dane, opcje) {
  const wgNajmu = (wiersze) => {
    const mapa = new Map();
    for (const w of wiersze) {
      if (!mapa.has(w.rental_id)) mapa.set(w.rental_id, []);
      mapa.get(w.rental_id).push(w);
    }
    return mapa;
  };
  const stawki = wgNajmu(dane.rental_rates);
  const korekty = wgNajmu(dane.charge_adjustments);
  return dane.rentals.flatMap((najem) => naleznosciNajmu(najem, {
    ...opcje, stawki: stawki.get(najem.id) ?? [], korekty: korekty.get(najem.id) ?? [],
  }));
}
