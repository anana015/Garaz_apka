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

test('rozbicie salda: otwarcie + wpłaty − należności = saldo z rozliczenia', async () => {
  const { rozliczKlienta, rozbicieSalda } = await import('../js/rozliczenia.js');
  const naleznosci = [
    { najemId: 'r1', kod: 'G-03', termin: '2026-10-20', poczatek: '2026-10-01', koniec: '2026-10-31', kwotaGr: 40000, korektaGr: -5000 },
    { najemId: 'r1', kod: 'G-03', termin: '2026-11-20', poczatek: '2026-11-01', koniec: '2026-11-30', kwotaGr: 45000 },
    { najemId: 'r2', kod: 'B-12', termin: '2026-11-20', poczatek: '2026-11-01', koniec: '2026-11-30', kwotaGr: 20000 },
    { najemId: 'r1', kod: 'G-03', termin: '2026-12-20', poczatek: '2026-12-01', koniec: '2026-12-31', kwotaGr: 45000 },
  ];
  const wplaty = [
    { booked_on: '2026-10-19', amount_gr: 30000, method: 'przelew' },
    { booked_on: '2026-11-02', amount_gr: 10000, method: 'gotowka' },
  ];
  const p = { naleznosci, wplaty, saldoOtwarcia: -5000, dataStart: '2026-01-01', dzis: '2026-11-25' };
  const r = rozliczKlienta(p);
  const b = rozbicieSalda({ pozycje: r.pozycje, wplaty, saldoOtwarcia: -5000, dzis: '2026-11-25' });
  assert.equal(b.saldoGr, r.saldoGr);
  assert.equal(b.naleznosciGr, 105000);
  assert.equal(b.korektyGr, -5000);
  assert.deepEqual(b.jednostki.map((j) => [j.kod, j.liczba]), [['B-12', 1], ['G-03', 2]]);
  assert.equal(b.formy.length, 2);
  assert.equal(b.niezaplacone.reduce((a, x) => a + x.brakGr, 0), r.zalegloscGr);
  assert.equal(b.nastepne.length, 1);
});

test('bramy: usunięcie numeru = {haslo}#TEL#{pozycja}#', async () => {
  const { polecenieUsuniecia, usuwanieWymagaPozycji } = await import('../js/bramy.js');
  const brama = { password: '1234' };
  assert.equal(polecenieUsuniecia(brama, { telefon: '+48600111222', pozycja: 205 }), '1234#TEL#205#');
  assert.equal(polecenieUsuniecia(brama, { telefon: '+48600111222', pozycja: 6 }), '1234#TEL#006#');
  assert.equal(usuwanieWymagaPozycji(brama), true);
});

test('rozliczone do 30.09: należności do terminu opłacone, wcześniejsze wpłaty i saldo otwarcia pominięte', async () => {
  const { rozliczKlienta, kartoteka, rozbicieSalda } = await import('../js/rozliczenia.js');
  const { doPrzypisania } = await import('../js/dane.js');
  const n = (m, kwota) => ({ najemId: 'r1', kod: 'G-03', termin: `2026-${m}-20`, poczatek: `2026-${m}-01`, koniec: `2026-${m}-28`, kwotaGr: kwota });
  const naleznosci = [n('08', 40000), n('09', 40000), n('10', 40000), n('11', 40000)];
  const wplaty = [
    { booked_on: '2026-09-18', amount_gr: 40000, method: 'przelew' },   // za wrzesień – pominięta
    { booked_on: '2026-10-19', amount_gr: 40000, method: 'przelew' },
  ];
  const p = { naleznosci, wplaty, saldoOtwarcia: -30000, dataStart: '2026-01-01', dzis: '2026-11-25', rozliczoneDo: '2026-09-30' };
  const r = rozliczKlienta(p);
  assert.equal(r.saldoGr, -40000, 'zaległy tylko listopad');
  assert.equal(r.zalegloscGr, 40000);
  assert.ok(r.pozycje.filter((x) => x.termin <= '2026-09-30').every((x) => x.rozliczone && x.zaplaconoGr === x.kwotaGr));
  assert.equal(r.pozycje.find((x) => x.termin === '2026-10-20').status, 'oplacona');
  const b = rozbicieSalda({ pozycje: r.pozycje, wplaty, saldoOtwarcia: -30000, dzis: '2026-11-25', rozliczoneDo: '2026-09-30', dataStart: '2026-01-01' });
  assert.equal(b.saldoGr, r.saldoGr);
  const k = kartoteka({ pozycje: r.pozycje, wplaty, saldoOtwarcia: -30000, dataStart: '2026-01-01', dzis: '2026-11-25', rozliczoneDo: '2026-09-30' });
  assert.equal(k.at(-1).saldoGr, r.saldoGr);
  assert.match(k[0].opis, /Rozliczone do 30\.09\.2026/);
  // Bez „rozliczone do” – jak dotąd
  assert.equal(rozliczKlienta({ ...p, rozliczoneDo: null }).saldoGr, -30000 + 80000 - 160000);
  const platnosci = [{ kind: 'czynsz', client_id: null, booked_on: '2026-09-10' }, { kind: 'czynsz', client_id: null, booked_on: '2026-10-10' }];
  assert.equal(doPrzypisania(platnosci, '2026-09-30').length, 1);
  assert.equal(doPrzypisania(platnosci).length, 2);
});

test('promocja startowa dla wszystkich boxów: plan, pominięcie istniejących, zachowanie podwyżki', async () => {
  const { planPromocjiBoxow } = await import('../js/promocje.js');
  const dane = {
    units: [{ id: 'u1', code: 'B-01', type: 'box_duzy' }, { id: 'u2', code: 'B-02', type: 'box_maly' }, { id: 'u3', code: 'G-01', type: 'garaz' },
      { id: 'u4', code: 'B-03', type: 'box_duzy' }],
    clients: [{ id: 'k1', name: 'A' }], contracts: [{ id: 'c1', client_id: 'k1' }],
    rentals: [
      { id: 'r1', contract_id: 'c1', unit_id: 'u1', start_on: '2026-01-15', end_on: null, period_months: 1 },
      { id: 'r2', contract_id: 'c1', unit_id: 'u2', start_on: '2026-09-25', end_on: null, period_months: 1 },
      { id: 'r3', contract_id: 'c1', unit_id: 'u3', start_on: '2026-09-01', end_on: null, period_months: 1 },
      { id: 'r4', contract_id: 'c1', unit_id: 'u4', start_on: '2026-03-03', end_on: null, period_months: 1 },
    ],
    rental_rates: [
      { id: 's1', rental_id: 'r1', valid_from: '2026-01-15', amount_gr: 18000 },
      { id: 's2', rental_id: 'r1', valid_from: '2026-02-01', amount_gr: 20000, reason: 'podwyżka' },
      { id: 's3', rental_id: 'r2', valid_from: '2026-09-25', amount_gr: 18000 },
      { id: 's4', rental_id: 'r4', valid_from: '2026-03-03', amount_gr: 10000, reason: 'Promocja startowa −50% / 2 mies.' },
      { id: 's5', rental_id: 'r4', valid_from: '2026-05-01', amount_gr: 20000, reason: 'koniec promocji' },
    ],
  };
  const s = { dane, indeksy: zbudujIndeksy({ ...stan().dane, ...dane, payments: [], gates: [], gate_access: [] }) };
  const wynik = Object.fromEntries(planPromocjiBoxow(s.dane, s.indeksy, { dzis: '2026-11-20' }).map((x) => [x.najem.id, x]));
  assert.equal(wynik.r3, undefined, 'garaż pominięty');
  assert.equal(wynik.r4.status, 'ma-promocje');
  // r1: start 15.01 (11.–22.) – rabat od 180 zł, po promocji 200 zł (podwyżka z 01.02 zachowana i usunięta ze środka promocji)
  assert.equal(wynik.r1.status, 'nowa');
  assert.equal(wynik.r1.plan.promocyjnaGr, 9000);
  assert.equal(wynik.r1.normalnaGr, 20000);
  assert.deepEqual(wynik.r1.doUsuniecia.map((x) => x.id), ['s2']);
  assert.equal(wynik.r1.wiersze.at(-1).valid_from, '2026-03-16');
  // r2: start 25.09 (od 23.) – końcówka gratis, październik i listopad po 90 zł, od grudnia 180 zł
  assert.equal(wynik.r2.plan.gratisDo, '2026-09-30');
  assert.deepEqual(wynik.r2.wiersze.map((w) => [w.valid_from, w.amount_gr]), [['2026-09-25', 0], ['2026-10-01', 9000], ['2026-12-01', 18000]]);
});
