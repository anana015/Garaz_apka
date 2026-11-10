import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dekoduj, wykryjSeparator, parsujCsv, naObiekty, doCsv } from '../js/csv.js';

test('dekoduj: UTF-8 z BOM i Windows-1250 z Excela (test 9)', () => {
  const utf8 = new TextEncoder().encode('﻿nazwa;miasto\nŻółć;Łódź\n');
  assert.equal(dekoduj(utf8), 'nazwa;miasto\nŻółć;Łódź\n');
  // „Żółć;Łódź” w Windows-1250
  const cp1250 = new Uint8Array([0xAF, 0xF3, 0xB3, 0xE6, 0x3B, 0xA3, 0xF3, 0x64, 0x9F]);
  assert.equal(dekoduj(cp1250), 'Żółć;Łódź');
});

test('wykryjSeparator: średnik, przecinek, tabulator; przecinki w cudzysłowie się nie liczą', () => {
  assert.equal(wykryjSeparator('a;b;c\n1;2;3'), ';');
  assert.equal(wykryjSeparator('a,b,c'), ',');
  assert.equal(wykryjSeparator('a\tb'), '\t');
  assert.equal(wykryjSeparator('"Nowak, Jan";"300,00"'), ';');
  assert.equal(wykryjSeparator('jedna'), ';');
});

test('parsujCsv: cudzysłowy, "" w polu, nowy wiersz w polu, \\r\\n, puste wiersze z numeracją jak w Excelu', () => {
  const tekst = 'numer;opis\r\nG-03;"brama; od ulicy"\r\n\r\nB-12;"dwie\nlinie"\r\nK-01;"mówi ""tak"""\r\n';
  const r = parsujCsv(tekst);
  assert.deepEqual(r.map((x) => x.nr), [1, 2, 4, 5]);
  assert.deepEqual(r[1].pola, ['G-03', 'brama; od ulicy']);
  assert.deepEqual(r[2].pola, ['B-12', 'dwie\nlinie']);
  assert.deepEqual(r[3].pola, ['K-01', 'mówi "tak"']);
  assert.deepEqual(parsujCsv('a;b').map((x) => x.pola), [['a', 'b']], 'bez końcowego znaku nowego wiersza');
});

test('naObiekty: nagłówki bez względu na wielkość liter, ogonki i spacje; brakujące kolumny', () => {
  const { wiersze, brakujace } = naObiekty(parsujCsv('Numer;Powierzchnia M2;Typ\nG-03; 18,5 ;garaż\n'),
    ['numer', 'typ', 'powierzchnia_m2', 'opis']);
  assert.deepEqual(brakujace, ['opis']);
  assert.deepEqual(wiersze, [{ nr: 2, w: { numer: 'G-03', typ: 'garaż', powierzchnia_m2: '18,5', opis: '' } }]);
});

test('doCsv: średnik, BOM, cudzysłowy tylko gdy trzeba (rozdz. 10)', () => {
  const csv = doCsv(['nazwa', 'kwota'], [['Nowak; Jan', '300,00'], ['Firma "X"', '-12,50']]);
  assert.equal(csv, '﻿nazwa;kwota\r\n"Nowak; Jan";300,00\r\n"Firma ""X""";-12,50\r\n');
  assert.deepEqual(parsujCsv(csv).map((r) => r.pola), [['nazwa', 'kwota'], ['Nowak; Jan', '300,00'], ['Firma "X"', '-12,50']]);
});
