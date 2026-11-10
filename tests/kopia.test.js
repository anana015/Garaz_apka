import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABELE } from '../js/config.js';
import { nazwaPlikuKopii, sprawdzKopie, WERSJA_KOPII, zbudujKopie } from '../js/kopia.js';
import { eksportDluznikow, eksportJednostek, eksportKlientow, eksportWplat, zlCsv } from '../js/eksport.js';
import { pusteDane } from '../js/state.js';

const U = { data_start: '2026-01-01', tolerance_days: 3, punctuality_months: 12 };

/** Klient z G-03 (300 zł, termin 15.) od 15.01.2026; wpłaty 15.01 i 15.02; dziś 10.04 → zaległe 15.03 i 15.04? (15.04 przyszłe) */
function dane() {
  const d = pusteDane();
  d.settings = { user_id: 'u', tolerance_days: 3 };
  d.units = [{ id: 'j1', code: 'G-03', type: 'garaz', area_m2: 18.5, list_price_gr: 30000 }, { id: 'j2', code: 'B-01', type: 'box_maly' }];
  d.clients = [{ id: 'k1', name: 'Jan Nowak', kind: 'osoba', phone: '600100200', opening_balance_gr: 0 }];
  d.contracts = [{ id: 'c1', client_id: 'k1', valid_until: null }];
  d.rentals = [{ id: 'r1', contract_id: 'c1', unit_id: 'j1', start_on: '2026-01-15', end_on: null, billing_day: 15, period_months: 1 }];
  d.rental_rates = [{ id: 's1', rental_id: 'r1', valid_from: '2026-01-15', amount_gr: 30000 }];
  d.bank_accounts = [{ id: 'b1', name: 'Nest – najem', bank: 'nest' }];
  d.payments = [
    { id: 'p1', booked_on: '2026-01-15', amount_gr: 30000, kind: 'czynsz', method: 'przelew', client_id: 'k1', bank_account_id: 'b1', counterparty: 'NOWAK JAN', title: 'czynsz; G-03' },
    { id: 'p2', booked_on: '2026-02-15', amount_gr: 30000, kind: 'czynsz', method: 'gotowka', client_id: 'k1' },
    { id: 'p3', booked_on: '2026-03-01', amount_gr: 5000, kind: 'czynsz', method: 'przelew', client_id: null, bank_account_id: 'b1' },
  ];
  d.client_notes = [{ id: 'n1', client_id: 'k1', kind: 'obietnica', body: 'zapłaci', promised_on: '2026-04-20', promised_gr: 30000 }];
  return d;
}

test('kopia: wszystkie 14 tabel, wersja formatu i data; nazwa pliku z datą i godziną', () => {
  const k = zbudujKopie(dane(), { wersjaAplikacji: '0.7.0', teraz: '2026-11-11T08:15:30.000Z' });
  assert.deepEqual(Object.keys(k.tables).sort(), [...TABELE].sort());
  assert.equal(k.version, WERSJA_KOPII);
  assert.equal(k.exported_at, '2026-11-11T08:15:30.000Z');
  assert.equal(k.tables.settings.length, 1);
  assert.equal(nazwaPlikuKopii(k.exported_at), 'najem_kopia_2026-11-11_0815.json');
});

test('kopia: odczyt własnego pliku (także z BOM) i liczby wierszy', () => {
  const tekst = `﻿${JSON.stringify(zbudujKopie(dane(), { wersjaAplikacji: '0.7.0', teraz: '2026-11-11T08:15:30.000Z' }))}`;
  const w = sprawdzKopie(tekst);
  assert.equal(w.blad, null);
  assert.equal(w.liczby.payments, 3);
  assert.equal(w.liczby.units, 2);
});

test('kopia: odrzuca zły plik, cudzy JSON, nowszą wersję i uszkodzone tabele', () => {
  assert.match(sprawdzKopie('nie json').blad, /nieprawidłowy JSON/);
  assert.match(sprawdzKopie('{"a":1}').blad, /nie jest kopią/);
  const k = zbudujKopie(dane(), { wersjaAplikacji: '9.0.0', teraz: '2026-11-11T08:15:30.000Z' });
  assert.match(sprawdzKopie(JSON.stringify({ ...k, version: WERSJA_KOPII + 1 })).blad, /nowszej wersji/);
  assert.match(sprawdzKopie(JSON.stringify({ ...k, tables: { ...k.tables, units: 'x' } })).blad, /units/);
  assert.match(sprawdzKopie(JSON.stringify({ ...k, tables: { ...k.tables, units: [{ code: 'G-01' }] } })).blad, /identyfikatora/);
});

test('eksport klientów: jednostki, saldo, zaległość, terminowość', () => {
  const { naglowek, wiersze } = eksportKlientow(dane(), { dzis: '2026-04-10', ustawienia: U });
  const w = Object.fromEntries(naglowek.map((n, i) => [n, wiersze[0][i]]));
  assert.equal(w.nazwa, 'Jan Nowak');
  assert.equal(w.jednostki, 'G-03');
  assert.equal(w.zaleglosc, '300,00');      // 15.03 nieopłacona
  assert.equal(w.saldo, '-300,00');
  assert.equal(w.dni_po_terminie, 26);
  assert.equal(w.ostatnia_wplata, '2026-02-15');
});

test('eksport jednostek: status, klient, stawka; wolna jednostka', () => {
  const { naglowek, wiersze } = eksportJednostek(dane(), { dzis: '2026-04-10', ustawienia: U });
  const kol = (n) => naglowek.indexOf(n);
  const [b01, g03] = wiersze;   // sortowanie po numerze: B-01, G-03
  assert.equal(b01[kol('status')], 'wolna');
  assert.equal(g03[kol('status')], 'zalega');
  assert.equal(g03[kol('klient')], 'Jan Nowak');
  assert.equal(g03[kol('stawka')], '300,00');
  assert.equal(g03[kol('powierzchnia_m2')], '18,5');
});

test('eksport wpłat: zakres dat, forma, konto, „do przypisania”', () => {
  const { wiersze } = eksportWplat(dane(), { od: '2026-02-01', do: '2026-03-31' });
  assert.equal(wiersze.length, 2);
  assert.deepEqual(wiersze[0].slice(0, 5), ['2026-02-15', '300,00', 'czynsz', 'gotówka', 'Jan Nowak']);
  assert.equal(wiersze[1][4], 'do przypisania');
  assert.equal(wiersze[1][5], 'Nest – najem (Nest Bank)');
  assert.equal(eksportWplat(dane()).wiersze.length, 3);
});

test('eksport dłużników: wiekowanie, kontakt i obietnica', () => {
  const { naglowek, wiersze } = eksportDluznikow(dane(), { dzis: '2026-04-10', ustawienia: U });
  assert.equal(wiersze.length, 1);
  const w = Object.fromEntries(naglowek.map((n, i) => [n, wiersze[0][i]]));
  assert.equal(w.zaleglosc, '300,00');
  assert.equal(w.do_30_dni, '300,00');
  assert.equal(w.ponad_90, '0,00');
  assert.equal(w.telefon, '600100200');
  assert.equal(w.obietnica_do, '2026-04-20');
  assert.equal(zlCsv(-1250), '-12,50');
});
