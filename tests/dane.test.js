import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zbudujIndeksy, najemTrwa, najemZakonczony, biezacyNajem, stawkaNaDzien, doPrzypisania,
  pelneMiesiaceWplat, ostatniaWplataNaKoncie, scalDane,
} from '../js/dane.js';

const dane = {
  units: [{ id: 'u1', code: 'G-03' }, { id: 'u2', code: 'B-12' }],
  clients: [{ id: 'k1', name: 'Jan Nowak' }],
  bank_accounts: [{ id: 'b1', name: 'Nest – najem' }],
  contracts: [{ id: 'c1', client_id: 'k1' }],
  rentals: [
    { id: 'r1', contract_id: 'c1', unit_id: 'u1', start_on: '2026-03-15', end_on: '2026-09-30' },
    { id: 'r2', contract_id: 'c1', unit_id: 'u2', start_on: '2026-04-01', end_on: null },
  ],
  rental_rates: [
    { rental_id: 'r1', valid_from: '2026-03-15', amount_gr: 30000 },
    { rental_id: 'r1', valid_from: '2026-07-01', amount_gr: 33000 },
  ],
};

test('zbudujIndeksy: najmy klienta przez umowy', () => {
  const ix = zbudujIndeksy(dane);
  assert.deepEqual(ix.najmyKlienta.get('k1').map((n) => n.id), ['r1', 'r2']);
  assert.equal(ix.najmyJednostki.get('u2')[0].id, 'r2');
  assert.equal(ix.stawkiNajmu.get('r1').length, 2);
  assert.equal(ix.konta.get('b1').name, 'Nest – najem');
});

test('najemTrwa / najemZakonczony na granicach dat', () => {
  const [r1, r2] = dane.rentals;
  assert.equal(najemTrwa(r1, '2026-03-14'), false);
  assert.equal(najemTrwa(r1, '2026-03-15'), true);
  assert.equal(najemTrwa(r1, '2026-09-30'), true);
  assert.equal(najemTrwa(r1, '2026-10-01'), false);
  assert.equal(najemZakonczony(r1, '2026-10-01'), true);
  assert.equal(najemTrwa(r2, '2030-01-01'), true);
  assert.equal(biezacyNajem(dane.rentals, '2026-11-09').id, 'r2');
});

test('stawkaNaDzien: najnowsza stawka nie późniejsza niż dzień', () => {
  const s = dane.rental_rates;
  assert.equal(stawkaNaDzien(s, '2026-03-14'), null);
  assert.equal(stawkaNaDzien(s, '2026-06-30'), 30000);
  assert.equal(stawkaNaDzien(s, '2026-07-01'), 33000);
  assert.equal(stawkaNaDzien([...s].reverse(), '2026-08-01'), 33000, 'kolejność wierszy bez znaczenia');
});

test('doPrzypisania: tylko czynsz bez klienta', () => {
  const w = [
    { kind: 'czynsz', client_id: null }, { kind: 'czynsz', client_id: 'k1' },
    { kind: 'kaucja', client_id: null }, { kind: 'pominieta', client_id: null },
  ];
  assert.equal(doPrzypisania(w).length, 1);
});

test('pelneMiesiaceWplat: próg 2 pełnych miesięcy dla Raportów (12.3)', () => {
  const w = (booked_on) => ({ booked_on });
  assert.equal(pelneMiesiaceWplat([], '2026-11-09'), 0);
  assert.equal(pelneMiesiaceWplat([w('2026-11-03')], '2026-11-09'), 0, 'bieżący miesiąc nie jest pełny');
  assert.equal(pelneMiesiaceWplat([w('2026-10-20')], '2026-11-09'), 1);
  assert.equal(pelneMiesiaceWplat([w('2026-11-02'), w('2026-09-30')], '2026-11-09'), 2, 'liczy od najstarszej');
  assert.equal(pelneMiesiaceWplat([w('2026-01-15')], '2026-11-09'), 10);
  assert.equal(pelneMiesiaceWplat([w('2025-12-31')], '2026-01-01'), 1, 'przełom roku');
});

test('ostatniaWplataNaKoncie: najnowsza data na każdym koncie, gotówka pominięta', () => {
  const m = ostatniaWplataNaKoncie([
    { bank_account_id: 'nest', booked_on: '2026-10-31' },
    { bank_account_id: 'nest', booked_on: '2026-11-02' },
    { bank_account_id: 'pko', booked_on: '2026-09-15' },
    { bank_account_id: null, booked_on: '2026-11-08' },
  ]);
  assert.deepEqual([...m.entries()].sort(), [['nest', '2026-11-02'], ['pko', '2026-09-15']]);
});

test('scalDane: podmienia po id, dopisuje nowe, nie zmienia starych tablic, settings jako obiekt', () => {
  const przed = { units: [{ id: 'u1', code: 'G-03' }, { id: 'u2', code: 'B-12' }], rentals: [], settings: null };
  const po = scalDane(przed, {
    units: [{ id: 'u2', code: 'B-13' }, { id: 'u3', code: 'K-01' }],
    rentals: [],
    settings: { tolerance_days: 5 },
    nieznana: [{ id: 'x' }],
  });
  assert.deepEqual(po.units.map((u) => u.code), ['G-03', 'B-13', 'K-01']);
  assert.equal(przed.units[1].code, 'B-12', 'dane wejściowe bez zmian');
  assert.equal(po.rentals, przed.rentals, 'pusta lista zmian – ta sama tablica');
  assert.equal(po.settings.tolerance_days, 5);
  assert.equal(po.nieznana, undefined);
});
