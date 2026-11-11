// Promocje: js/promocje.js i jednorazowy SQL supabase/jednorazowe/promocja_startowa_boxy.sql (PGlite).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import {
  DOMYSLNE_PROMOCJE, czytajWarunki, listaPromocji, nowaPozycja, planPromocji, stawkaPromocyjna, wierszeStawek,
} from '../js/promocje.js';
import { dodajDni } from '../js/utils.js';

const najem = (start_on, billing_day = 20, period_months = 1, end_on = null) =>
  ({ id: 'n', start_on, end_on, billing_day, period_months });

test('plan promocji: N miesięcy od startu zaokrąglone do 1. dnia miesiąca (okresy kalendarzowe)', () => {
  assert.deepEqual(planPromocji(najem('2026-09-05'), { normalnaGr: 20000, rabat: 50, okresy: 2 }),
    { poczatek: '2026-09-05', koniec: '2026-11-01', promocyjnaGr: 10000 });
  assert.equal(planPromocji(najem('2026-09-01'), { normalnaGr: 20000, rabat: 50, okresy: 2 }).koniec, '2026-11-01');
  assert.equal(planPromocji(najem('2026-09-20'), { normalnaGr: 20000, rabat: 50, okresy: 2 }).koniec, '2026-12-01');
  assert.equal(planPromocji(najem('2026-09-05'), { normalnaGr: 18000, rabat: 50, okresy: 1 }).koniec, '2026-10-01');
  // najem kończy się w trakcie promocji → bez stawki „koniec promocji”
  const p = planPromocji(najem('2026-09-05', 20, 1, '2026-10-31'), { normalnaGr: 20000, rabat: 50, okresy: 2 });
  assert.equal(p.koniec, null);
  assert.equal(wierszeStawek('n', p, 20000, 'x').length, 1);
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

test('SQL: koniec promocji taki sam jak w aplikacji (planPromocji)', async () => {
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
    const js = planPromocji(najem(start, dzien, okres), { normalnaGr: 20000, rabat: 50, okresy: 2 });
    assert.equal(plan.get(ids[i]), js.koniec, `start ${start}, dzień ${dzien}, okres ${okres}`);
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
