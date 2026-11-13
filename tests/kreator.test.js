import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujIndeksy } from '../js/dane.js';
import {
  krokiKonca, krokiMiesiaca, krokiNowegoKlienta, miesiacPrzegladu, postep, powrotDoKreatora, STANY,
} from '../js/kreator.js';
import { przygotujZapytanie, szukajWszedzie } from '../js/szukaj.js';
import { ostatniePrzypomnienie } from '../js/zadania.js';

function stan(zmiany = {}) {
  const dane = {
    units: [
      { id: 'u1', code: 'G-03', type: 'garaz', has_power: true },
      { id: 'u2', code: 'B-12', type: 'box_duzy' },
    ],
    clients: [{ id: 'k1', name: 'Jan Nowak', phone: '600 100 200', email: 'jan@example.pl' }, { id: 'k2', name: 'Łucja Żółć' }],
    bank_accounts: [{ id: 'b1', name: 'Nest' }],
    contracts: [{ id: 'c1', client_id: 'k1' }, { id: 'c2', client_id: 'k2' }],
    rentals: [
      { id: 'r1', contract_id: 'c1', unit_id: 'u1', start_on: '2026-03-01', end_on: null, notice_given_on: '2026-10-20', notice_end_on: '2026-11-30' },
      { id: 'r2', contract_id: 'c2', unit_id: 'u2', start_on: '2026-11-10', end_on: null },
    ],
    rental_rates: [],
    deposits: [{ contract_id: 'c1', kind: 'przyjecie', amount_gr: 50000, method: 'gotowka' }],
    gates: [{ id: 'g1', numer: 1 }, { id: 'g2', numer: 2 }],
    gate_access: [{ id: 'a1', gate_id: 'g1', client_id: 'k1', phone: '+48600100200', slot: 205, removed_on: null }],
    power_readings: [],
    payments: [{ id: 'p1', kind: 'czynsz', client_id: null, amount_gr: 20000, booked_on: '2026-11-05', counterparty: 'KOWALSKI ADAM', title: 'Najem G-07' }],
    imports: [],
    client_notes: [],
    expenses: [],
    ...zmiany,
  };
  return { dane, indeksy: zbudujIndeksy(dane) };
}

test('nowy klient: kroki czekają na klienta, potem na najem; box bez kaucji', () => {
  const s = stan();
  const pusty = krokiNowegoKlienta(s, {}, '2026-11-13');
  assert.equal(pusty[0].stan, STANY.doZrobienia);
  assert.ok(pusty.slice(1).every((k) => k.stan === STANY.czeka));

  const zNajmem = krokiNowegoKlienta(s, { klientId: 'k2', najemId: 'r2' }, '2026-11-13');
  const wg = Object.fromEntries(zNajmem.map((k) => [k.id, k]));
  assert.equal(wg.klient.stan, STANY.zrobione);
  assert.equal(wg.najem.stan, STANY.zrobione);
  assert.equal(wg.umowa.stan, STANY.doZrobienia);
  assert.equal(wg.brama.nazwa, 'Brama 2');
  assert.equal(wg.brama.stan, STANY.doZrobienia);
  assert.equal(wg.kaucja.stan, STANY.pominiete, 'boxy bez kaucji');
  assert.equal(postep(zNajmem).nastepny.id, 'umowa');

  const poUmowie = krokiNowegoKlienta(s, { klientId: 'k2', najemId: 'r2', reczne: new Set(['umowa']) }, '2026-11-13');
  assert.equal(postep(poUmowie).nastepny.id, 'brama');
});

test('zakończenie najmu: wypowiedzenie zrobione, koniec później, brama po końcu + 3 dni', () => {
  const s = stan();
  const kroki = Object.fromEntries(krokiKonca(s, 'r1', '2026-11-13').map((k) => [k.id, k]));
  assert.equal(kroki.wypowiedzenie.stan, STANY.zrobione);
  assert.equal(kroki.prad.stan, STANY.doZrobienia);
  assert.equal(kroki.koniec.stan, STANY.pozniej);
  assert.equal(kroki.kaucja.stan, STANY.czeka);
  assert.equal(kroki.brama.stan, STANY.pozniej);
  assert.match(kroki.brama.opis, /03\.12\.2026/);

  // Po zakończeniu: kaucja do rozliczenia, brama do usunięcia.
  const s2 = stan({ rentals: [{ ...s.dane.rentals[0], end_on: '2026-11-30' }, s.dane.rentals[1]] });
  const po = Object.fromEntries(krokiKonca(s2, 'r1', '2026-12-05').map((k) => [k.id, k]));
  assert.equal(po.koniec.stan, STANY.zrobione);
  assert.equal(po.kaucja.stan, STANY.doZrobienia);
  assert.equal(po.brama.stan, STANY.doZrobienia);
});

test('miesięczny przegląd: miesiąc od 15. dnia, kroki z danych', () => {
  assert.equal(miesiacPrzegladu('2026-11-13'), '2026-10');
  assert.equal(miesiacPrzegladu('2026-11-20'), '2026-11');
  assert.equal(miesiacPrzegladu('2026-01-03'), '2025-12');
  const s = stan();
  const kroki = Object.fromEntries(krokiMiesiaca(s, { miesiac: '2026-11', dzis: '2026-11-25', doPrzypomnienia: 2 }).map((k) => [k.id, k]));
  assert.equal(kroki.wyciagi.stan, STANY.doZrobienia);
  assert.equal(kroki.przypisz.stan, STANY.doZrobienia);
  assert.equal(kroki.przypomnienia.stan, STANY.doZrobienia);
  assert.equal(kroki.koszty.stan, STANY.doZrobienia);
  assert.equal(kroki.zadania.stan, STANY.zrobione);
  const przed = Object.fromEntries(krokiMiesiaca(s, { miesiac: '2026-11', dzis: '2026-11-15' }).map((k) => [k.id, k]));
  assert.equal(przed.przypomnienia.stan, STANY.pozniej);
});

test('powrót do kreatora po zapisie formularza: id klienta i nowego najmu z adresu', () => {
  const k = { typ: 'klient', href: '#/kreator/klient' };
  assert.equal(powrotDoKreatora(k, 'klienci/abc'), 'kreator/klient?klient=abc');
  const k2 = { typ: 'klient', href: '#/kreator/klient?klient=abc' };
  assert.equal(powrotDoKreatora(k2, 'klienci/abc?nowy=r9'), 'kreator/klient?klient=abc&najem=r9');
  assert.equal(powrotDoKreatora({ typ: 'koniec', href: '#/kreator/koniec/r1' }, 'klienci/abc'), 'kreator/koniec/r1');
  assert.equal(powrotDoKreatora({ typ: 'miesiac', href: '#/kreator/miesiac' }, 'wplaty'), null);
});

test('wyszukiwarka: bez ogonków, telefon, kod jednostki bez myślnika, kwota i nadawca wpłaty', () => {
  const s = stan();
  assert.deepEqual(szukajWszedzie(s, 'zolc').klienci.map((k) => k.id), ['k2']);
  assert.deepEqual(szukajWszedzie(s, '600100').klienci.map((k) => k.id), ['k1']);
  assert.deepEqual(szukajWszedzie(s, 'g03').jednostki.map((j) => j.code), ['G-03']);
  assert.deepEqual(szukajWszedzie(s, '200').wplaty.map((w) => w.id), ['p1']);
  assert.deepEqual(szukajWszedzie(s, 'adam kowalski').wplaty.map((w) => w.id), ['p1']);
  assert.equal(szukajWszedzie(s, 'n').razem, 0, 'za krótko');
  assert.equal(szukajWszedzie(s, 'nowak', { tylkoKlienci: true }).jednostki.length, 0);
  assert.equal(przygotujZapytanie('200,50 zł').kwotaGr, 20050);
});

test('ostatnie przypomnienie o płatności z notatek klienta', () => {
  const notatki = [
    { client_id: 'k1', body: 'Przypomnienie o płatności (200,00 zł): …', created_at: '2026-11-02T10:00:00Z' },
    { client_id: 'k1', body: 'Przypomnienie o płatności (100,00 zł): …', created_at: '2026-11-10T10:00:00Z' },
    { client_id: 'k1', body: 'Telefon – obiecał', created_at: '2026-11-12T10:00:00Z' },
  ];
  assert.equal(ostatniePrzypomnienie(notatki, 'k1'), '2026-11-10');
  assert.equal(ostatniePrzypomnienie(notatki, 'k2'), null);
});
