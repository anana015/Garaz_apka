import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  naleznosciNajmu, wszystkieNaleznosci, pierwszyDzienPlatnosci, doPelnychZlotych,
} from '../js/okresy.js';

const OPCJE = { dataStart: '2026-01-01', dzis: '2026-11-09' };
const najem = (pola) => ({
  id: 'r1', unit_id: 'u1', start_on: '2026-03-15', end_on: null, billing_day: 15,
  period_months: 1, last_period: 'proporcjonalnie', ...pola,
});
const stawka = (valid_from, zl) => ({ rental_id: 'r1', valid_from, amount_gr: zl * 100 });
/** Mapa termin → kwota w zł, do czytelnych porównań. */
const kwoty = (naleznosci) => Object.fromEntries(naleznosci.map((n) => [n.termin, n.kwotaGr / 100]));

// Model od 11.11.2026: okresy = miesiące kalendarzowe, termin = dzień płatności (20.) w miesiącu okresu.

test('test 1 (nowy model): start 15.03, płatne 20., podwyżka od 01.07 obowiązuje od lipca', () => {
  const n = naleznosciNajmu(najem({ billing_day: 20 }), {
    ...OPCJE, stawki: [stawka('2026-03-15', 300), stawka('2026-07-01', 330)] });
  assert.deepEqual([n[0].poczatek, n[0].koniec, n[0].termin, n[0].rodzaj], ['2026-03-15', '2026-03-31', '2026-03-20', 'pierwszy-niepelny']);
  assert.equal(n[0].kwotaGr, 16500, '300 × 17 ÷ 31 = 164,52 → 165 zł');
  const k = kwoty(n);
  assert.equal(k['2026-04-20'], 300);
  assert.equal(k['2026-06-20'], 300);
  assert.equal(k['2026-07-20'], 330);
  assert.ok(n.slice(1).every((x) => x.poczatek.endsWith('-01') && x.termin === `${x.poczatek.slice(0, 8)}20`));
});

test('termin w niepełnym okresie nie wcześniej niż start: start 25.03 → termin 25.03', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-03-25', billing_day: 20 }), { ...OPCJE, stawki: [stawka('2026-03-25', 310)] });
  assert.deepEqual([n[0].termin, n[0].dni, n[0].kwotaGr], ['2026-03-25', 7, 7000]);
  assert.equal(n[1].termin, '2026-04-20');
});

test('test 3 (nowy model): koniec najmu 15.09 – wrzesień proporcjonalnie, przy „pełny okres” cały', () => {
  const stawki = [stawka('2026-03-15', 300)];
  const n = naleznosciNajmu(najem({ billing_day: 20, end_on: '2026-09-15' }), { ...OPCJE, stawki });
  const ost = n.at(-1);
  assert.deepEqual([ost.poczatek, ost.koniec, ost.rodzaj, ost.dni, ost.dniOkresu, ost.kwotaGr],
    ['2026-09-01', '2026-09-15', 'ostatni-niepelny', 15, 30, 15000]);
  assert.equal(naleznosciNajmu(najem({ billing_day: 20, end_on: '2026-09-15', last_period: 'pelny' }), { ...OPCJE, stawki }).at(-1).kwotaGr, 30000);
});

test('dzień płatności 31 → ostatni dzień krótszego miesiąca (Z5)', () => {
  const n = naleznosciNajmu(najem({ start_on: '2027-01-01', billing_day: 31 }), {
    dataStart: '2026-01-01', dzis: '2027-01-01', horyzontMiesiecy: 2, stawki: [stawka('2027-01-01', 300)] });
  assert.deepEqual(n.map((x) => x.termin), ['2027-01-31', '2027-02-28', '2027-03-31']);
});

test('horyzont: bez daty końca okresy do dziś + 24 miesiące', () => {
  const n = naleznosciNajmu(najem({ billing_day: 20 }), { ...OPCJE, stawki: [stawka('2026-03-15', 300)] });
  assert.equal(n.at(-1).poczatek, '2028-11-01', 'ostatni początek ≤ 09.11.2028');
});

test('Z6: okres kwartalny od 1. dnia miesiąca – kwota × 3', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-04-01', billing_day: 20, period_months: 3 }), {
    ...OPCJE, stawki: [stawka('2026-04-01', 300)] });
  assert.deepEqual(n.slice(0, 2).map((x) => [x.termin, x.koniec, x.kwotaGr]), [
    ['2026-04-20', '2026-06-30', 90000],
    ['2026-07-20', '2026-09-30', 90000],
  ]);
});

test('Z34: najem sprzed 1.01.2026 – okres 15.12.2025–14.01.2026 jest w saldzie otwarcia', () => {
  const n = naleznosciNajmu(najem({ start_on: '2025-06-15' }), {
    ...OPCJE, stawki: [stawka('2025-06-15', 280), stawka('2026-01-01', 300)] });
  assert.equal(n[0].termin, '2026-01-15', 'styczeń 2026 – pełny miesiąc, termin 15.');
  assert.equal(n[0].kwotaGr, 30000);
  assert.ok(n.every((x) => x.termin >= '2026-01-01'));
});

test('Z34: późniejsze wczytanie danych z 2025 r. – wystarczy zmienić data_start', () => {
  const opcje = { dataStart: '2025-01-01', dzis: '2026-11-09', stawki: [stawka('2025-06-15', 280)] };
  const n = naleznosciNajmu(najem({ start_on: '2025-06-15' }), opcje);
  assert.equal(n[0].termin, '2025-06-15');
  assert.equal(n.find((x) => x.termin === '2025-12-15').kwotaGr, 28000);
});

test('najem zakończony przed data_start nie ma należności', () => {
  assert.deepEqual(naleznosciNajmu(najem({ start_on: '2025-03-01', end_on: '2025-11-30', billing_day: 1 }), {
    ...OPCJE, stawki: [stawka('2025-03-01', 300)] }), []);
});

test('Z7 + Z8: najem krótszy niż niepełny pierwszy okres', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-03-10', end_on: '2026-03-20', billing_day: 1 }), {
    ...OPCJE, stawki: [stawka('2026-03-10', 310)] });
  assert.equal(n.length, 1);
  assert.deepEqual([n[0].dni, n[0].dniOkresu, n[0].kwotaGr], [11, 31, 11000], '310 × 11 ÷ 31 = 110 zł');
});

test('korekty: dodają się do okresu, wynik nie spada poniżej 0 zł', () => {
  const n = naleznosciNajmu(najem(), {
    ...OPCJE,
    stawki: [stawka('2026-03-15', 300)],
    korekty: [
      { rental_id: 'r1', period_start: '2026-05-15', amount_gr: -10000, reason: 'rabat' },
      { rental_id: 'r1', period_start: '2026-06-15', amount_gr: -50000, reason: 'umorzenie' },
      { rental_id: 'r1', period_start: '2026-07-20', amount_gr: 2500, reason: 'dopłata w trakcie okresu' },
    ],
  });
  const k = kwoty(n);
  assert.equal(k['2026-05-15'], 200);
  assert.equal(k['2026-06-15'], 0);
  assert.equal(k['2026-07-15'], 325, 'korekta z datą w środku okresu trafia do tego okresu');
  assert.equal(n.find((x) => x.termin === '2026-06-15').korektaGr, -50000);
});

test('rok przestępny: dzień 31 → 29.02.2028', () => {
  const n = naleznosciNajmu(najem({ start_on: '2028-01-31', billing_day: 31 }), {
    dataStart: '2026-01-01', dzis: '2028-01-31', horyzontMiesiecy: 3, stawki: [stawka('2028-01-31', 300)] });
  assert.deepEqual(n.map((x) => x.termin), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
});

test('brak stawki na dzień okresu: kwota 0 i znacznik do ostrzeżenia', () => {
  const n = naleznosciNajmu(najem(), { ...OPCJE, stawki: [stawka('2026-05-01', 300)] });
  assert.equal(n[0].brakStawki, true);
  assert.equal(n[0].kwotaGr, 0);
  assert.equal(n.find((x) => x.termin === '2026-05-15').brakStawki, false);
});

test('błędne dane najmu są odrzucane z opisem', () => {
  const opcje = { ...OPCJE, stawki: [] };
  assert.throws(() => naleznosciNajmu(najem({ billing_day: 0 }), opcje), /dzień płatności/);
  assert.throws(() => naleznosciNajmu(najem({ period_months: 2 }), opcje), /okres 2/);
  assert.throws(() => naleznosciNajmu(najem({ end_on: '2026-03-01' }), opcje), /data końca/);
  assert.throws(() => naleznosciNajmu(najem(), { stawki: [] }), /data_start/);
});

test('wszystkieNaleznosci: stawki i korekty przypisane do właściwych najmów', () => {
  const dane = {
    rentals: [najem({ id: 'a' }), najem({ id: 'b', start_on: '2026-04-01', billing_day: 1, end_on: '2026-05-31' })],
    rental_rates: [
      { rental_id: 'a', valid_from: '2026-03-15', amount_gr: 30000 },
      { rental_id: 'b', valid_from: '2026-04-01', amount_gr: 15000 },
    ],
    charge_adjustments: [{ rental_id: 'b', period_start: '2026-05-01', amount_gr: -5000 }],
  };
  const n = wszystkieNaleznosci(dane, OPCJE);
  const b = n.filter((x) => x.najemId === 'b');
  assert.deepEqual(b.map((x) => x.kwotaGr), [15000, 10000]);
  assert.ok(n.filter((x) => x.najemId === 'a').slice(1).every((x) => x.kwotaGr === 30000), 'po niepełnym marcu');
});

test('pomocnicze: pierwszy dzień płatności i zaokrąglenie do złotego', () => {
  assert.equal(pierwszyDzienPlatnosci('2026-03-10', 1), '2026-04-01');
  assert.equal(pierwszyDzienPlatnosci('2026-03-15', 15), '2026-03-15');
  assert.equal(pierwszyDzienPlatnosci('2027-02-28', 31), '2027-02-28');
  assert.equal(pierwszyDzienPlatnosci('2026-12-20', 5), '2027-01-05');
  assert.equal(doPelnychZlotych(17649), 17600);
  assert.equal(doPelnychZlotych(21290), 21300);
  assert.equal(doPelnychZlotych(15050), 15100, 'od 50 groszy w górę');
});
