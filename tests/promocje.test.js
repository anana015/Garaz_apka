// Promocje: js/promocje.js i jednorazowy SQL supabase/jednorazowe/promocja_startowa_boxy.sql (PGlite).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import {
  DOMYSLNE_PROMOCJE, czytajWarunki, harmonogramPromocji, listaPromocji, nowaPozycja, planPromocji, podwyzkiNajmu,
  promocjaNajmu, promocjeNajmu, stawkaPromocyjna, wierszeStawek, zestawienieStawek,
} from '../js/promocje.js';
import { pierwszyOkresOd } from '../js/okresy.js';
import { dodajDni, dodajMiesiace } from '../js/utils.js';

/** Reguła końca promocji z 0.13.0 – nadal w jednorazowym SQL (najmy sprzed 0.19.0). */
const koniecStarejReguly = (n, okresy) => {
  const poczatek = pierwszyOkresOd(n, n.start_on);
  return pierwszyOkresOd(n, dodajDni(dodajMiesiace(poczatek, okresy * (n.period_months ?? 1)), -15));
};

const najem = (start_on, billing_day = 20, period_months = 1, end_on = null) =>
  ({ id: 'n', start_on, end_on, billing_day, period_months });

const P = { normalnaGr: 20000, rabat: 50, okresy: 2 };
const miesiace = (n, plan) => harmonogramPromocji(n, { plan, normalnaGr: 20000 }).map((m) => [m.poczatek.slice(0, 7), m.kwotaGr / 100]);

test('promocja 12.11: start 11.–22. – do 12.01 po 100 zł, od 13.01 po 200 zł (przykład z 12.11.2026)', () => {
  const n = najem('2026-11-12');
  const plan = planPromocji(n, P);
  assert.equal(plan.wariant, 'srodek-miesiaca');
  assert.deepEqual([plan.poczatek, plan.promocjaOd, plan.koniec, plan.gratisDo], ['2026-11-12', '2026-11-12', '2027-01-13', null]);
  assert.deepEqual(wierszeStawek('n', plan, 20000, 'Startowa').map((w) => [w.valid_from, w.amount_gr, w.from_day]),
    [['2026-11-12', 10000, true], ['2027-01-13', 20000, true]]);
  assert.deepEqual(miesiace(n, plan), [['2026-11', 60], ['2026-12', 100], ['2027-01', 160]],
    'styczeń: 12/31 × 100 = 38,71 → 40 zł + 19/31 × 200 = 122,58 → 120 zł');
});

test('promocja: start 1.–10. – ten miesiąc to 1. miesiąc promocji; od 23. – końcówka gratis', () => {
  const a = planPromocji(najem('2026-11-05'), P);
  assert.deepEqual([a.wariant, a.poczatek, a.koniec], ['poczatek-miesiaca', '2026-11-05', '2027-01-01']);
  assert.deepEqual(miesiace(najem('2026-11-05'), a), [['2026-11', 90], ['2026-12', 100], ['2027-01', 200]]);
  assert.deepEqual(miesiace(najem('2026-11-01'), planPromocji(najem('2026-11-01'), P)),
    [['2026-11', 100], ['2026-12', 100], ['2027-01', 200]]);

  const b = planPromocji(najem('2026-11-25'), P);
  assert.deepEqual([b.wariant, b.poczatek, b.gratisDo, b.promocjaOd, b.koniec],
    ['koniec-miesiaca', '2026-11-25', '2026-11-30', '2026-12-01', '2027-02-01']);
  assert.deepEqual(wierszeStawek('n', b, 20000, 'Startowa').map((w) => [w.valid_from, w.amount_gr, w.from_day]),
    [['2026-11-25', 0, true], ['2026-12-01', 10000, false], ['2027-02-01', 20000, false]]);
  assert.deepEqual(miesiace(najem('2026-11-25'), b), [['2026-11', 0], ['2026-12', 100], ['2027-01', 100], ['2027-02', 200]]);

  // granice przedziałów
  assert.equal(planPromocji(najem('2026-11-10'), P).wariant, 'poczatek-miesiaca');
  assert.equal(planPromocji(najem('2026-11-11'), P).wariant, 'srodek-miesiaca');
  assert.equal(planPromocji(najem('2026-11-22'), P).koniec, '2027-01-23');
  assert.equal(planPromocji(najem('2026-11-23'), P).wariant, 'koniec-miesiaca');
  // 1 miesiąc
  assert.equal(planPromocji(najem('2026-11-12'), { ...P, okresy: 1 }).koniec, '2026-12-13');
});

test('promocja: od dnia w trwającym najmie, koniec najmu w trakcie, okresy kwartalne (stara reguła)', () => {
  // trwający najem od 03.03, promocja od 05.11 → cały listopad z rabatem (od 01.11)
  assert.equal(planPromocji(najem('2026-03-03'), { ...P, od: '2026-11-05' }).poczatek, '2026-11-01');
  const p = planPromocji(najem('2026-09-12', 20, 1, '2026-10-31'), P);
  assert.equal(p.koniec, null);
  assert.equal(wierszeStawek('n', p, 20000, 'x').length, 1);
  const k = planPromocji(najem('2026-05-02', 20, 3), P);
  assert.deepEqual([k.wariant, k.koniec], ['okresy', koniecStarejReguly(najem('2026-05-02', 20, 3), 2)]);
  assert.equal(wierszeStawek('n', k, 20000, 'x').every((w) => w.from_day === false), true);
});

test('rozpoznanie promocji i podwyżek w historii stawek', () => {
  const st = (od, zl, reason, from_day = false) => ({ valid_from: od, amount_gr: zl * 100, reason, from_day });
  const historia = [st('2024-03-01', 180, 'start'), st('2026-02-01', 200, 'podwyżka 2026'),
    st('2026-11-25', 0, 'Startowa – końcówka miesiąca gratis', true), st('2026-12-01', 100, 'Startowa'),
    st('2027-02-01', 200, 'koniec promocji'), st('2027-06-01', 220, 'podwyżka 2027')];
  const [p] = promocjeNajmu(historia);
  assert.deepEqual([p.od, p.do, p.nazwa, p.gratisDo, p.promocyjnaGr, p.regularnaGr],
    ['2026-11-25', '2027-01-31', 'Startowa', '2026-11-30', 10000, 20000]);
  assert.deepEqual(promocjaNajmu(historia, '2026-11-27'), { od: '2026-11-25', do: '2027-01-31', nazwa: 'Startowa' });
  assert.equal(promocjaNajmu(historia, '2027-02-01'), null);
  assert.deepEqual(podwyzkiNajmu(historia).map((x) => [x.od, x.zGr / 100, x.naGr / 100]),
    [['2026-02-01', 180, 200], ['2027-06-01', 200, 220]]);
  // starszy zapis: tańsza stawka start i promocja → „start” nie wchodzi do promocji
  const stary = [st('2025-01-01', 90, 'start'), st('2026-10-05', 100, 'Promocja startowa'), st('2026-12-01', 200, 'koniec promocji')];
  assert.equal(promocjeNajmu(stary)[0].od, '2026-10-05');
  assert.deepEqual(podwyzkiNajmu(stary), []);
});

test('zestawienie: kto korzysta, kto skorzystał, podwyżki i ręczne zmiany kwot', () => {
  const dane = {
    rentals: [{ id: 'r1', contract_id: 'c1', unit_id: 'u1', start_on: '2026-11-12', end_on: null },
      { id: 'r2', contract_id: 'c2', unit_id: 'u2', start_on: '2026-01-05', end_on: null }],
    rental_rates: [],
    charge_adjustments: [{ id: 'a1', rental_id: 'r2', period_start: '2026-12-01', amount_gr: -5000, reason: 'obniżka' }],
  };
  const stawki = new Map([
    ['r1', [{ valid_from: '2026-11-12', amount_gr: 10000, reason: 'Startowa' }, { valid_from: '2027-01-13', amount_gr: 20000, reason: 'koniec promocji' }]],
    ['r2', [{ valid_from: '2026-01-05', amount_gr: 9000, reason: 'Startowa' }, { valid_from: '2026-03-01', amount_gr: 18000, reason: 'koniec promocji' },
      { valid_from: '2026-07-01', amount_gr: 19000, reason: 'podwyżka' }]],
  ]);
  const ix = { umowy: new Map([['c1', { client_id: 'k1' }], ['c2', { client_id: 'k2' }]]),
    klienci: new Map([['k1', { id: 'k1', name: 'Nowa' }], ['k2', { id: 'k2', name: 'Stara' }]]),
    jednostki: new Map([['u1', { code: 'B-1' }], ['u2', { code: 'B-2' }]]), stawkiNajmu: stawki };
  const z = zestawienieStawek(dane, ix, '2026-12-15');
  assert.deepEqual(z.promocje.map((p) => [p.klient.name, p.status, p.do]), [['Nowa', 'trwa', '2027-01-12'], ['Stara', 'zakonczona', '2026-02-28']]);
  assert.deepEqual(z.podwyzki.map((p) => [p.klient.name, p.od, p.zGr, p.naGr]), [['Stara', '2026-07-01', 18000, 19000]]);
  assert.deepEqual(z.zmianyKwot.map((x) => [x.klient.name, x.okres, x.kwotaGr]), [['Stara', '2026-12-01', -5000]]);
});

test('stawka promocyjna do pełnych złotych, warunki z formularza', () => {
  assert.equal(stawkaPromocyjna(18000, 50), 9000);
  assert.equal(stawkaPromocyjna(19900, 50), 10000);   // 99,50 → 100
  assert.equal(stawkaPromocyjna(20000, 15), 17000);
  assert.deepEqual(czytajWarunki({ rabat: '50%', okresy: '2' }), { bledy: {}, rabat: 50, okresy: 2 });
  assert.ok(czytajWarunki({ rabat: '100', okresy: '0' }).bledy.rabat);
  assert.ok(czytajWarunki({ rabat: '10', okresy: '1,5' }).bledy.okresy);
});

test('lista promocji: domyślna, z ustawień, nowa pozycja z unikalnym id', () => {
  assert.deepEqual(listaPromocji({ promotions: null }).map((p) => p.id), ['startowa', 'pierwszy-miesiac']);
  assert.deepEqual(listaPromocji({ promotions: [] }), []);
  const lista = [...DOMYSLNE_PROMOCJE];
  const a = nowaPozycja(lista, { nazwa: 'Zniżka dla stałego klienta', rabat: 20, okresy: 3 });
  assert.equal(a.id, 'znizka-dla-stalego-klienta');
  assert.equal(nowaPozycja([...lista, a], { nazwa: 'Zniżka dla stałego klienta', rabat: 20, okresy: 3 }).id, 'znizka-dla-stalego-klienta-2');
});

// ---------------------------------------------------------------------
// SQL jednorazowy
// ---------------------------------------------------------------------

const U = '00000000-0000-4000-8000-0000000000aa';
const DZIS = '2026-11-11';
let db;
let skrypt;

const MIGRACJE = new URL('../supabase/migracje/', import.meta.url);

before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  const czytaj = (url) => readFile(url, 'utf8');
  await db.exec(await czytaj(new URL('./supabase-stub.sql', import.meta.url)));
  await db.exec(await czytaj(new URL('../supabase/schema.sql', import.meta.url)));
  for (const m of (await readdir(MIGRACJE)).filter((p) => p.endsWith('.sql')).sort()) {
    await db.exec(await czytaj(new URL(m, MIGRACJE)));
  }
  skrypt = (await czytaj(new URL('../supabase/jednorazowe/promocja_startowa_boxy.sql', import.meta.url)))
    .replaceAll('current_date', `date '${DZIS}'`);
  await db.query('insert into public.settings (user_id) values ($1)', [U]);
  await db.query(`insert into public.clients (id, user_id, name) values ('00000000-0000-4000-8000-0000000000c1', $1, 'Klient')`, [U]);
  await db.query(`insert into public.contracts (id, user_id, client_id) values
    ('00000000-0000-4000-8000-0000000000d1', $1, '00000000-0000-4000-8000-0000000000c1')`, [U]);
});

let nr = 0;
/** Najem z jednostką i stawkami: stawki = [[valid_from, zł], …]. Zwraca id najmu. */
async function dodajNajem(typ, start, stawki, { koniec = null, dzien = 20, okres = 1 } = {}) {
  nr += 1;
  const jed = `00000000-0000-4000-8000-${String(nr).padStart(12, '0')}`;
  const naj = `00000000-0000-4000-9000-${String(nr).padStart(12, '0')}`;
  await db.query('insert into public.units (id, user_id, code, type) values ($1, $2, $3, $4)', [jed, U, `J-${nr}`, typ]);
  await db.query(`insert into public.rentals (id, user_id, contract_id, unit_id, start_on, end_on, billing_day, period_months)
    values ($1, $2, '00000000-0000-4000-8000-0000000000d1', $3, $4, $5, $6, $7)`, [naj, U, jed, start, koniec, dzien, okres]);
  for (const [od, zl] of stawki) {
    await db.query('insert into public.rental_rates (user_id, rental_id, valid_from, amount_gr) values ($1, $2, $3, $4)',
      [U, naj, od, zl * 100]);
  }
  return naj;
}

const stawkiNajmu = async (id) => (await db.query(
  `select to_char(valid_from, 'YYYY-MM-DD') as od, amount_gr / 100 as zl from public.rental_rates
   where rental_id = $1 order by valid_from`, [id])).rows.map((r) => [r.od, Number(r.zl)]);

test('SQL: koniec promocji taki sam jak stara reguła z 0.13.0 (najmy sprzed 0.19.0)', async () => {
  const przypadki = [];
  for (let d = '2025-11-03'; d <= '2026-12-31'; d = dodajDni(d, 11)) przypadki.push([d, 20, 1]);
  przypadki.push(['2026-01-31', 31, 1], ['2026-03-15', 31, 1], ['2026-05-02', 20, 3], ['2026-02-28', 30, 1]);
  const ids = [];
  for (const [start, dzien, okres] of przypadki) ids.push(await dodajNajem('box_duzy', start, [[start, 200]], { dzien, okres }));
  const wynik = await db.exec(skrypt);
  const plan = new Map((await db.query("select id, to_char(koniec, 'YYYY-MM-DD') as koniec from promo_plan")).rows
    .map((r) => [r.id, r.koniec]));
  assert.ok(wynik.length > 0);
  przypadki.forEach(([start, dzien, okres], i) => {
    assert.equal(plan.get(ids[i]), koniecStarejReguly(najem(start, dzien, okres), 2), `start ${start}, dzień ${dzien}, okres ${okres}`);
  });
  // podgląd niczego nie zapisał
  assert.deepEqual(await stawkiNajmu(ids[0]), [[przypadki[0][0], 200]]);
  await db.exec('delete from public.rental_rates; delete from public.rentals; delete from public.units');
});

test('SQL: zapis promocji dla boxów, pominięcia i przypadki do sprawdzenia', async () => {
  const wPromocji = await dodajNajem('box_duzy', '2026-10-05', [['2026-10-05', 100]]);
  const pelna = await dodajNajem('box_maly', '2026-04-10', [['2026-04-10', 180]]);
  const stary = await dodajNajem('box_duzy', '2024-03-01', [['2024-03-01', 180], ['2026-02-01', 200]]);
  const doSprawdzenia = await dodajNajem('box_maly', '2026-07-25', [['2026-07-25', 90]]);
  const garaz = await dodajNajem('garaz', '2026-09-05', [['2026-09-05', 300]]);
  const grudzien = await dodajNajem('box_duzy', '2025-12-10', [['2025-12-10', 180], ['2026-02-01', 200]]);
  const zakonczony = await dodajNajem('box_duzy', '2026-03-01', [['2026-03-01', 200]], { koniec: '2026-06-30' });

  const zapis = skrypt.replace(/^  false as zapisz,/m, '  true as zapisz,');
  await db.exec(zapis);
  await db.exec(zapis);
  const poPierwszym = await stawkiNajmu(grudzien);
  await db.exec(zapis);   // drugi raz – najmy z promocją pominięte, bez zmian
  assert.deepEqual(await stawkiNajmu(grudzien), poPierwszym);

  assert.deepEqual(await stawkiNajmu(wPromocji), [['2026-10-05', 100], ['2026-12-01', 200]]);
  assert.deepEqual(await stawkiNajmu(pelna), [['2026-04-10', 90], ['2026-06-01', 180]]);
  assert.deepEqual(await stawkiNajmu(stary), [['2024-03-01', 180], ['2026-02-01', 200]]);
  assert.deepEqual(await stawkiNajmu(doSprawdzenia), [['2026-07-25', 90]]);
  assert.deepEqual(await stawkiNajmu(garaz), [['2026-09-05', 300]]);
  assert.deepEqual(await stawkiNajmu(grudzien), [['2025-12-10', 90], ['2026-02-01', 200]]);
  assert.deepEqual(await stawkiNajmu(zakonczony), [['2026-03-01', 200]]);

  const { rows } = await db.query('select id, status from promo_plan');
  const status = new Map(rows.map((r) => [r.id, r.status]));
  assert.match(status.get(stary), /^pominięty: promocja przed/);
  assert.match(status.get(doSprawdzenia), /^DO SPRAWDZENIA/);
  assert.equal(status.has(garaz), false);
  assert.equal(status.has(zakonczony), false);
  const powody = (await db.query('select reason from public.rental_rates where rental_id = $1 order by valid_from', [pelna])).rows;
  assert.deepEqual(powody.map((r) => r.reason), ['Promocja startowa −50% / 2 mies.', 'koniec promocji']);
});
