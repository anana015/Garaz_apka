import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rozliczKlienta } from '../js/rozliczenia.js';

test('wpłata przypisana ręcznie do jednostki: najpierw ten najem, reszta – pozostałe od najstarszej', () => {
  const nal = (najemId, kod, termin, kwotaGr) => ({ najemId, kod, termin, poczatek: termin, koniec: termin, kwotaGr });
  const naleznosci = [nal('r1', 'G-03', '2026-04-20', 30000), nal('r2', 'B-12', '2026-04-20', 15000),
    nal('r1', 'G-03', '2026-05-20', 30000), nal('r2', 'B-12', '2026-05-20', 15000)];
  const auto = rozliczKlienta({ naleznosci, wplaty: [{ booked_on: '2026-04-21', amount_gr: 30000 }], dataStart: '2026-01-01', dzis: '2026-04-25' });
  // automatycznie: najstarszy termin, przy równym – numer jednostki (B-12 przed G-03)
  assert.deepEqual(auto.pozycje.map((p) => [p.kod, p.zaplaconoGr]), [['B-12', 15000], ['G-03', 15000], ['B-12', 0], ['G-03', 0]]);
  const recznie = rozliczKlienta({ naleznosci, wplaty: [{ booked_on: '2026-04-21', amount_gr: 40000, rental_id: 'r1' }],
    dataStart: '2026-01-01', dzis: '2026-04-25' });
  // 400 zł „za G-03”: kwiecień G-03 (300 zł) i przedpłata maja G-03 (100 zł); B-12 nietknięty
  assert.deepEqual(recznie.pozycje.map((p) => [p.kod, p.termin.slice(5, 7), p.zaplaconoGr]),
    [['B-12', '04', 0], ['G-03', '04', 30000], ['B-12', '05', 0], ['G-03', '05', 10000]]);
  // gdy cały najem G-03 jest już pokryty, nadwyżka idzie na pozostałe jednostki od najstarszej
  const nadwyzka = rozliczKlienta({ naleznosci, wplaty: [{ booked_on: '2026-04-21', amount_gr: 70000, rental_id: 'r1' }],
    dataStart: '2026-01-01', dzis: '2026-04-25' });
  assert.deepEqual(nadwyzka.pozycje.map((p) => p.zaplaconoGr), [10000, 30000, 0, 30000]);
});
