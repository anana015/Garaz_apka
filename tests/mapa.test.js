// Mapa placu (0.16.0): układ z mapki użytkownika i dopasowanie kodów jednostek do miejsc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GORA, MIEJSCA, miejsceJednostki, rozmiescJednostki, SZEROKOSC, WYSOKOSC } from '../js/mapa.js';

test('układ: 70 miejsc w rzędach, 15 dużych i 6 małych boxów, klucze unikalne', () => {
  const ile = (typ) => MIEJSCA.filter((m) => m.typ === typ).length;
  assert.equal(ile('rzad'), 20 + 18 + 19 + 13);
  assert.equal(ile('box_duzy'), 15);
  assert.equal(ile('box_maly'), 6);
  assert.equal(new Set(MIEJSCA.map((m) => m.klucz)).size, MIEJSCA.length);
  for (const m of MIEJSCA) assert.ok(m.x >= 0 && m.y >= GORA && m.x + m.w <= SZEROKOSC && m.y + m.h <= WYSOKOSC, m.klucz);
});

test('układ: miejsca na siebie nie nachodzą', () => {
  for (const a of MIEJSCA) for (const b of MIEJSCA) {
    if (a === b) continue;
    const kolizja = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!kolizja, `${a.klucz} / ${b.klucz}`);
  }
});

test('kody garaży i kontenerów: G05R1, g5r1, K-12-R3', () => {
  assert.equal(miejsceJednostki({ code: 'G05R1', type: 'garaz' }), 'R1-5');
  assert.equal(miejsceJednostki({ code: 'g5r1', type: 'garaz' }), 'R1-5');
  assert.equal(miejsceJednostki({ code: 'K-12-R3', type: 'kontener' }), 'R3-12');
  assert.equal(miejsceJednostki({ code: 'G19 R3', type: 'garaz' }), 'R3-19');
  assert.equal(miejsceJednostki({ code: 'G-03', type: 'garaz' }), null);
});

test('boxy: numer z kodu, rozmiar z typu', () => {
  assert.equal(miejsceJednostki({ code: 'B07', type: 'box_duzy' }), 'BD-7');
  assert.equal(miejsceJednostki({ code: 'B4', type: 'box_maly' }), 'BM-4');
  assert.equal(miejsceJednostki({ code: 'BOX', type: 'box_maly' }), null);
  assert.equal(miejsceJednostki({ code: 'B01XS', type: 'box_duzy' }), 'BM-1');   // końcówka ważniejsza niż typ
  assert.equal(miejsceJednostki({ code: 'b02xl', type: 'box_maly' }), 'BD-2');
});

test('rozmieszczenie: poza mapą, duplikaty, archiwum pominięte', () => {
  const j = (id, code, type = 'garaz', archived = false) => ({ id, code, type, archived });
  const w = rozmiescJednostki([j('1', 'G05R1'), j('2', 'G5R1'), j('3', 'G30R1'), j('4', 'G01R2', 'garaz', true), j('5', 'B16', 'box_duzy')]);
  assert.equal(w.naMapie.get('R1-5').id, '1');
  assert.deepEqual(w.duplikaty.map((x) => x.id), ['2']);
  assert.deepEqual(w.pozaMapa.map((x) => x.id), ['3', '5']);
  assert.equal(w.naMapie.size, 1);
});
