import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doPelnychZl, dzienRoboczy, kwartalyDoZaplaty, progRoku, ryczaltOd, terminKwartalu, wielkanoc, wierszeCsv,
  zestawienieRoku,
} from '../js/podatek.js';
import { walidujWplateRyczaltu } from '../js/walidacja.js';

const U = { tax_rate_low_bp: 850, tax_rate_high_bp: 1250, tax_threshold_gr: 10_000_000, data_start: '2026-01-01' };
const zl = (n) => Math.round(n * 100);
const wplata = (booked_on, kwotaZl, extra = {}) => ({ booked_on, amount_gr: zl(kwotaZl), kind: 'czynsz', method: 'przelew', ...extra });

/** Przykład z 6.2: 30 000 / 32 000 / 33 000 / 20 000 zł w kolejnych kwartałach 2026. */
const PRZYKLAD = [wplata('2026-02-10', 30000), wplata('2026-05-10', 32000), wplata('2026-08-10', 33000), wplata('2026-11-10', 20000)];

test('zaokrąglenie do pełnych zł (art. 63 § 1 OP): poniżej 50 gr w dół, od 50 gr w górę', () => {
  assert.equal(doPelnychZl(12349), 12300);
  assert.equal(doPelnychZl(12350), 12400);
  assert.equal(doPelnychZl(-12350), -12400);
  assert.equal(doPelnychZl(0), 0);
});

test('f(x): 8,5% do 100 000 zł i 12,5% od nadwyżki', () => {
  assert.equal(ryczaltOd(zl(30000), U), zl(2550));
  assert.equal(ryczaltOd(zl(115000), U), zl(10375));
  assert.equal(ryczaltOd(-500, U), 0);
});

test('przykład z 6.2 i test 12: ryczałt kwartałów 2 550 / 2 720 / 2 805 / 2 300 zł, rok 10 375 zł', () => {
  const z = zestawienieRoku({ payments: PRZYKLAD, tax_payments: [] }, { rok: 2026, dzis: '2027-02-01', ustawienia: U });
  assert.deepEqual(z.kwartaly.map((k) => k.ryczaltGr), [2550, 2720, 2805, 2300].map(zl));
  assert.deepEqual(z.kwartaly.map((k) => k.narastajacoGr), [30000, 62000, 95000, 115000].map(zl));
  assert.equal(z.ryczaltRocznyGr, zl(10375));
  assert.equal(z.ryczaltKwartalyGr, zl(10375));
  assert.equal(z.kwartaly[3].termin, '2027-01-20');
  assert.equal(z.kwartaly[3].ponadProgiem, true);
  assert.equal(z.kwartaly[2].ponadProgiem, false);
});

test('przychód: czynsz, inny przychód, gotówka i zatrzymana kaucja tak; kaucja i pominięte nie; zwrot pomniejsza', () => {
  const payments = [
    wplata('2026-01-05', 1000), wplata('2026-01-06', 200, { kind: 'przychod_inny' }),
    wplata('2026-01-07', 300, { method: 'gotowka' }), wplata('2026-01-08', 150, { method: 'kaucja' }),
    wplata('2026-01-09', 500, { kind: 'kaucja' }), wplata('2026-01-10', 50, { kind: 'pominieta' }),
    wplata('2026-01-11', -100),
  ];
  const z = zestawienieRoku({ payments, tax_payments: [] }, { rok: 2026, dzis: '2026-06-01', ustawienia: U });
  assert.equal(z.miesiace[0].przychodGr, zl(1550));
  assert.equal(z.kwartaly[0].przychodGr, zl(1550));
});

test('przychód i ryczałt kwartału zaokrąglone do pełnych zł', () => {
  const payments = [wplata('2026-01-05', 1000.49), wplata('2026-04-05', 1000.50)];
  const z = zestawienieRoku({ payments, tax_payments: [] }, { rok: 2026, dzis: '2026-12-01', ustawienia: U });
  assert.equal(z.kwartaly[0].przychodGr, zl(1000));
  assert.equal(z.kwartaly[1].przychodGr, zl(1001));
  assert.equal(z.kwartaly[0].ryczaltGr, zl(85));      // 85,00
  assert.equal(z.kwartaly[1].ryczaltGr, zl(85));      // 85,085 → 85
});

test('kwartał z przewagą zwrotów: ryczałt 0 zł i flaga do sprawdzenia', () => {
  const payments = [wplata('2026-01-05', 1000), wplata('2026-04-05', -300)];
  const z = zestawienieRoku({ payments, tax_payments: [] }, { rok: 2026, dzis: '2026-12-01', ustawienia: U });
  assert.equal(z.kwartaly[1].ryczaltGr, 0);
  assert.equal(z.kwartaly[1].ujemny, true);
});

test('terminy: 20. dzień po kwartale, przesunięcie z soboty, niedzieli i świąt na dzień roboczy', () => {
  assert.equal(wielkanoc(2025), '2025-04-20');
  assert.equal(wielkanoc(2026), '2026-04-05');
  assert.deepEqual([1, 2, 3, 4].map((q) => terminKwartalu(2026, q)), ['2026-04-20', '2026-07-20', '2026-10-20', '2027-01-20']);
  assert.equal(terminKwartalu(2025, 1), '2025-04-22');   // 20.04 niedziela Wielkanocna, 21.04 Poniedziałek Wielkanocny
  assert.equal(terminKwartalu(2027, 3), '2027-10-20');
  assert.equal(dzienRoboczy('2026-06-20'), '2026-06-22');   // sobota → poniedziałek
  assert.equal(dzienRoboczy('2026-12-24'), '2026-12-28');   // Wigilia, święta, weekend
});

test('statusy: zapłacony, wpłacono za mało, po terminie, do zapłaty, w trakcie, przyszły', () => {
  const tax_payments = [{ year: 2026, quarter: 1, paid_on: '2026-04-15', amount_gr: zl(2550) },
    { year: 2026, quarter: 2, paid_on: '2026-07-15', amount_gr: zl(2000) }];
  const dane = { payments: PRZYKLAD, tax_payments };
  const st = (dzis) => zestawienieRoku(dane, { rok: 2026, dzis, ustawienia: U }).kwartaly.map((k) => k.status);
  assert.deepEqual(st('2026-10-10'), ['zaplacony', 'niedoplata', 'do_zaplaty', 'biezacy']);
  assert.deepEqual(st('2026-10-21'), ['zaplacony', 'niedoplata', 'po_terminie', 'biezacy']);
  assert.deepEqual(st('2026-05-01'), ['zaplacony', 'zaplacony', 'przyszly', 'przyszly']);   // wpłata z góry za trwający kwartał
  const z = zestawienieRoku(dane, { rok: 2026, dzis: '2027-02-01', ustawienia: U });
  assert.equal(z.wplaconoGr, zl(4550));
  assert.equal(z.roznicaGr, zl(10375 - 4550));
});

test('kwartały do zapłaty na pulpicie: IV kwartał poprzedniego roku w styczniu; bez lat sprzed startu danych', () => {
  const lista = kwartalyDoZaplaty({ payments: PRZYKLAD, tax_payments: [] }, { dzis: '2027-01-10', ustawienia: U });
  assert.deepEqual(lista.map((k) => `${k.rok}-${k.q}-${k.status}`),
    ['2026-1-po_terminie', '2026-2-po_terminie', '2026-3-po_terminie', '2026-4-do_zaplaty']);
  assert.deepEqual(kwartalyDoZaplaty({ payments: [], tax_payments: [] }, { dzis: '2026-02-01', ustawienia: U }), []);
});

test('próg 100 000 zł: data przekroczenia i prognoza ze średniej 3 ostatnich pełnych miesięcy', () => {
  const p = progRoku(PRZYKLAD, { rok: 2026, dzis: '2026-12-31', ustawienia: U });
  assert.equal(p.sumaGr, zl(115000));
  assert.equal(p.dataPrzekroczenia, '2026-11-10');
  // 10 000 zł miesięcznie od stycznia; 15.06: 50 000 zł (czerwiec jeszcze bez wpłaty) → próg przekroczony w listopadzie
  const rowno = Array.from({ length: 12 }, (_, i) => wplata(`2026-${String(i + 1).padStart(2, '0')}-10`, 10000));
  const w = progRoku(rowno, { rok: 2026, dzis: '2026-06-05', ustawienia: U });
  assert.equal(w.sumaGr, zl(50000));
  assert.equal(w.dataPrzekroczenia, null);
  assert.equal(w.prognoza, '2026-11');
});

test('CSV do PIT-28: 12 miesięcy, 4 kwartały i rok, kwoty z przecinkiem', () => {
  const z = zestawienieRoku({ payments: PRZYKLAD, tax_payments: [{ year: 2026, quarter: 1, paid_on: '2026-04-15', amount_gr: zl(2550) }] },
    { rok: 2026, dzis: '2027-02-01', ustawienia: U });
  const w = wierszeCsv(z);
  assert.equal(w.length, 17);
  assert.deepEqual(w[12], ['2026 I kw.', '30000,00', '30000,00', '2550,00', '2026-04-20', '2550,00', '2026-04-15', '0,00']);
  assert.deepEqual(w[16], ['2026 rok', '115000,00', '115000,00', '10375,00', '', '2550,00', '', '7825,00']);
});

test('walidacja wpłaty ryczałtu: data wymagana i nie z przyszłości, kwota ≥ 0', () => {
  const ok = walidujWplateRyczaltu({ paid_on: '2026-04-15', amount_gr: '2 550' }, { rok: 2026, q: 1, dzis: '2026-11-10' });
  assert.deepEqual(ok.bledy, {});
  assert.deepEqual(ok.wiersz, { year: 2026, quarter: 1, grupa: 'pozostale', paid_on: '2026-04-15', amount_gr: 255000 });
  const zle = walidujWplateRyczaltu({ paid_on: '2026-12-01', amount_gr: '-5' }, { rok: 2026, q: 1, dzis: '2026-11-10' });
  assert.ok(zle.bledy.paid_on);
  assert.ok(zle.bledy.amount_gr);
  assert.ok(walidujWplateRyczaltu({ paid_on: '', amount_gr: '' }, { rok: 2026, q: 1, dzis: '2026-11-10' }).bledy.paid_on);
});
