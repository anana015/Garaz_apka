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

test('test 1: 300 zł od 15.03.2026, podwyżka do 330 zł od 01.07.2026 obowiązuje od okresu 15.07', () => {
  const n = naleznosciNajmu(najem(), {
    ...OPCJE, stawki: [stawka('2026-03-15', 300), stawka('2026-07-01', 330)] });
  const k = kwoty(n);
  for (const t of ['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15']) assert.equal(k[t], 300, t);
  assert.equal(k['2026-07-15'], 330);
  assert.equal(k['2026-11-15'], 330);
  assert.equal(n[0].poczatek, '2026-03-15');
  assert.equal(n[0].koniec, '2026-04-14');
  assert.ok(n.every((x) => x.termin === x.poczatek), 'termin = pierwszy dzień okresu (Z4)');
  assert.ok(n.every((x) => x.rodzaj === 'pelny'));
});

test('test 2: dzień płatności 31 – luty 2027 → 28.02, marzec → 31.03 (Z5)', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-10-31', billing_day: 31 }), {
    ...OPCJE, stawki: [stawka('2026-10-31', 300)] });
  const terminy = n.map((x) => x.termin);
  assert.deepEqual(terminy.slice(0, 6),
    ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  const luty = n.find((x) => x.termin === '2027-02-28');
  assert.equal(luty.koniec, '2027-03-30');
  assert.equal(luty.kwotaGr, 30000, 'krótszy okres nie zmienia kwoty');
});

test('test 3: koniec najmu 30.09.2026, okres 15.09–14.10, 330 zł → 176 zł, przy „pełny okres” 330 zł', () => {
  const stawki = [stawka('2026-03-15', 300), stawka('2026-07-01', 330)];
  const n = naleznosciNajmu(najem({ end_on: '2026-09-30' }), { ...OPCJE, stawki });
  const ostatnia = n.at(-1);
  assert.equal(ostatnia.termin, '2026-09-15');
  assert.equal(ostatnia.rodzaj, 'ostatni-niepelny');
  assert.equal(ostatnia.dni, 16);
  assert.equal(ostatnia.dniOkresu, 30);
  assert.equal(ostatnia.koniec, '2026-09-30');
  assert.equal(ostatnia.kwotaGr, 17600);
  assert.equal(n.length, 7, 'od 15.03 do 15.09, nic po końcu najmu');

  const pelny = naleznosciNajmu(najem({ end_on: '2026-09-30', last_period: 'pelny' }), { ...OPCJE, stawki });
  assert.equal(pelny.at(-1).kwotaGr, 33000);
});

test('Z7: start 10.03, płatność 1. dnia, 300 zł → pierwszy okres 10.03–31.03 za 213 zł', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-03-10', billing_day: 1 }), {
    ...OPCJE, stawki: [stawka('2026-03-10', 300)] });
  assert.equal(n[0].rodzaj, 'pierwszy-niepelny');
  assert.equal(n[0].koniec, '2026-03-31');
  assert.deepEqual([n[0].dni, n[0].dniOkresu], [22, 31]);
  assert.equal(n[0].kwotaGr, 21300, '300 × 22 ÷ 31 = 212,90 → 213 zł');
  assert.equal(n[1].termin, '2026-04-01');
  assert.equal(n[1].kwotaGr, 30000);
});

test('Z7: dzień płatności wcześniejszy niż dzień startu – pełny okres liczony wstecz od dnia płatności', () => {
  const n = naleznosciNajmu(najem({ start_on: '2026-03-20', billing_day: 5 }), {
    ...OPCJE, stawki: [stawka('2026-03-20', 300)] });
  assert.equal(n[0].koniec, '2026-04-04');
  assert.deepEqual([n[0].dni, n[0].dniOkresu], [16, 31], '20.03–04.04 z okresu 05.03–04.04');
  assert.equal(n[0].kwotaGr, 15500, '300 × 16 ÷ 31 = 154,84 → 155 zł');
  assert.equal(n[1].termin, '2026-04-05');
});

test('Z5 przy starcie: 28.02 z dniem płatności 31 to pełny okres, nie niepełny', () => {
  const n = naleznosciNajmu(najem({ start_on: '2027-02-28', billing_day: 31 }), {
    dataStart: '2026-01-01', dzis: '2027-03-01', stawki: [stawka('2027-02-28', 300)] });
  assert.equal(n[0].rodzaj, 'pelny');
  assert.equal(n[0].koniec, '2027-03-30');
  assert.equal(n[1].termin, '2027-03-31');
});

test('Z34: najem sprzed 1.01.2026 – okres 15.12.2025–14.01.2026 jest w saldzie otwarcia', () => {
  const n = naleznosciNajmu(najem({ start_on: '2025-06-15' }), {
    ...OPCJE, stawki: [stawka('2025-06-15', 280), stawka('2026-01-01', 300)] });
  assert.equal(n[0].termin, '2026-01-15');
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

test('horyzont: bez daty końca okresy do dziś + 24 miesiące', () => {
  const n = naleznosciNajmu(najem(), { ...OPCJE, stawki: [stawka('2026-03-15', 300)] });
  assert.equal(n.at(-1).termin, '2028-10-15', 'ostatni początek ≤ 09.11.2028');
  assert.equal(n.length, 32);
});

test('Z6: okres kwartalny – kwota × 3, terminy co 3 miesiące', () => {
  const n = naleznosciNajmu(najem({ period_months: 3 }), { ...OPCJE, stawki: [stawka('2026-03-15', 300)] });
  assert.deepEqual(n.slice(0, 3).map((x) => [x.termin, x.koniec, x.kwotaGr]), [
    ['2026-03-15', '2026-06-14', 90000],
    ['2026-06-15', '2026-09-14', 90000],
    ['2026-09-15', '2026-12-14', 90000],
  ]);
});

test('Z6 + Z8: kwartał przerwany końcem najmu – proporcja z dni kwartału', () => {
  const n = naleznosciNajmu(najem({ period_months: 3, end_on: '2026-07-14' }), {
    ...OPCJE, stawki: [stawka('2026-03-15', 300)] });
  const ost = n.at(-1);
  assert.deepEqual([ost.termin, ost.dni, ost.dniOkresu], ['2026-06-15', 30, 92]);
  assert.equal(ost.kwotaGr, 29300, '900 × 30 ÷ 92 = 293,48 → 293 zł');
});

test('Z8: koniec najmu w ostatnim dniu okresu to pełna kwota; w pierwszym dniu – 1 dzień', () => {
  const stawki = [stawka('2026-03-15', 330)];
  assert.equal(naleznosciNajmu(najem({ end_on: '2026-10-14' }), { ...OPCJE, stawki }).at(-1).kwotaGr, 33000);
  const jedenDzien = naleznosciNajmu(najem({ end_on: '2026-09-15' }), { ...OPCJE, stawki }).at(-1);
  assert.deepEqual([jedenDzien.dni, jedenDzien.kwotaGr], [1, 1100], '330 × 1 ÷ 30 = 11 zł');
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
  assert.ok(n.filter((x) => x.najemId === 'a').every((x) => x.kwotaGr === 30000));
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
