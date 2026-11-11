// Test schematu bazy na prawdziwym PostgreSQL (PGlite, WASM).
// Uruchomienie: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const TABELE = ['units', 'clients', 'contracts', 'rentals', 'rental_rates', 'charge_adjustments',
  'bank_accounts', 'imports', 'payments', 'payers', 'deposits', 'client_notes',
  'tax_payments', 'settings', 'expenses', 'cost_rules'];

let db;

/** Przełącza sesję na zalogowanego użytkownika (rola authenticated + auth.uid()). */
async function jako(userId) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec('set role authenticated');
}

/** Oczekuje błędu bazy z komunikatem pasującym do wzorca. */
async function oczekujBledu(sql, params, wzorzec) {
  await assert.rejects(db.query(sql, params), (e) => wzorzec.test(e.message));
}

const MIGRACJE = new URL('../supabase/migracje/', import.meta.url);
/** Pliki migracji w kolejności numerów (001_…, 002_…). */
const migracje = async () => (await readdir(MIGRACJE)).filter((p) => p.endsWith('.sql')).sort()
  .map((p) => new URL(p, MIGRACJE));

before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  const czytaj = (url) => readFile(url, 'utf8');
  await db.exec(await czytaj(new URL('./supabase-stub.sql', import.meta.url)));
  // Tak jak w Supabase: najpierw schemat (uruchomiony 10.11.2026), potem migracje po kolei.
  await db.exec(await czytaj(new URL('../supabase/schema.sql', import.meta.url)));
  for (const m of await migracje()) await db.exec(await czytaj(m));
});

test('migracje można uruchomić drugi raz bez błędu', async () => {
  await db.exec('reset role');
  for (const m of await migracje()) await db.exec(await readFile(m, 'utf8'));
  const { rows } = await db.query(`select conname from pg_constraint
    where conname in ('units_code_dlugosc', 'clients_name_dlugosc', 'settings_zakresy')`);
  assert.equal(rows.length, 3, 'każde ograniczenie raz');
});

test('schemat ma 16 tabel, każda z RLS i polityką own_rows', async () => {
  await db.exec('reset role');
  const { rows } = await db.query(`
    select c.relname as tabela, c.relrowsecurity as rls,
           exists (select 1 from pg_policies p
                   where p.tablename = c.relname and p.policyname = 'own_rows') as polityka
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`);
  assert.deepEqual(rows.map((r) => r.tabela).sort(), [...TABELE].sort());
  for (const r of rows) {
    assert.equal(r.rls, true, `RLS wyłączone: ${r.tabela}`);
    assert.equal(r.polityka, true, `brak polityki: ${r.tabela}`);
  }
});

test('RLS: użytkownik B nie widzi ani nie podszywa się pod dane A', async () => {
  await jako(A);
  await db.query("insert into units (code, type) values ('G-03', 'garaz')");
  assert.equal((await db.query('select * from units')).rows.length, 1);

  await jako(B);
  assert.equal((await db.query('select * from units')).rows.length, 0);
  await oczekujBledu("insert into units (user_id, code, type) values ($1, 'X-1', 'box_duzy')", [A],
    /row-level security/);
  // ten sam numer jednostki u innego użytkownika jest dozwolony
  await db.query("insert into units (code, type) values ('G-03', 'garaz')");
});

test('anon nie ma dostępu do tabel', async () => {
  await db.exec('reset role');
  await db.exec('set role anon');
  await oczekujBledu('select * from units', [], /permission denied/);
  await db.exec('reset role');
});

test('numer jednostki unikalny w obrębie użytkownika', async () => {
  await jako(A);
  await oczekujBledu("insert into units (code, type) values ('G-03', 'garaz')", [], /duplicate key/);
});

test('test 16: drugi najem tej samej jednostki w nakładającym się okresie jest odrzucony', async () => {
  await jako(A);
  const unit = (await db.query("select id from units where code = 'G-03'")).rows[0].id;
  const client = (await db.query("insert into clients (name) values ('Jan Nowak') returning id")).rows[0].id;
  const contract = (await db.query('insert into contracts (client_id, number) values ($1, $2) returning id',
    [client, 'U/1/2026'])).rows[0].id;
  const najem = (start, end) => db.query(
    `insert into rentals (contract_id, unit_id, start_on, end_on, billing_day)
     values ($1, $2, $3, $4, 15) returning id`, [contract, unit, start, end]);

  await najem('2026-03-15', '2026-09-30');
  await assert.rejects(najem('2026-09-30', null), /rentals_no_overlap/, 'ten sam dzień końca i startu');
  await assert.rejects(najem('2026-01-01', '2026-03-15'), /rentals_no_overlap/);
  await najem('2026-10-01', null);                                   // styk dzień po dniu – OK
  await assert.rejects(najem('2027-05-01', null), /rentals_no_overlap/, 'najem bezterminowy blokuje przyszłość');
});

test('koniec najmu nie może być przed startem; dzień płatności 1–31', async () => {
  await jako(A);
  const { rows: [r] } = await db.query('select contract_id, unit_id from rentals limit 1');
  await oczekujBledu(
    "insert into rentals (contract_id, unit_id, start_on, end_on, billing_day) values ($1, $2, '2030-02-01', '2030-01-01', 1)",
    [r.contract_id, r.unit_id], /check constraint/);
  await oczekujBledu(
    "insert into rentals (contract_id, unit_id, start_on, billing_day) values ($1, $2, '2031-01-01', 32)",
    [r.contract_id, r.unit_id], /check constraint/);
});

test('klienta z umową nie da się usunąć (on delete restrict)', async () => {
  await jako(A);
  await oczekujBledu("delete from clients where name = 'Jan Nowak'", [], /foreign key/);
});

test('walidacja formatów: NIP, rachunek, kwota wpłaty ≠ 0', async () => {
  await jako(A);
  await oczekujBledu("insert into clients (name, nip) values ('Firma', '123-456-78-90')", [], /check constraint/);
  await db.query("insert into clients (name, kind, nip) values ('Firma', 'firma', '5260250274')");
  await oczekujBledu("insert into payments (booked_on, amount_gr) values ('2026-04-02', 0)", [], /check constraint/);
  await oczekujBledu("insert into payments (booked_on, amount_gr, payer_account) values ('2026-04-02', 100, 'PL123')",
    [], /check constraint/);
});

test('klucz duplikatu wpłat jest unikalny, wpłaty gotówkowe (bez klucza) nie', async () => {
  await jako(A);
  const ins = (key) => db.query(
    "insert into payments (booked_on, amount_gr, dedup_key) values ('2026-04-02', 90000, $1)", [key]);
  await ins('konto|2026-04-02|90000||CZYNSZ');
  await assert.rejects(ins('konto|2026-04-02|90000||CZYNSZ'), /duplicate key/);
  await ins(null);
  await ins(null);
});

test('ustawienia: wiersz z wartościami domyślnymi', async () => {
  await jako(A);
  const { rows: [s] } = await db.query('insert into settings default values returning *');
  assert.equal(s.user_id, A);
  assert.equal(s.tolerance_days, 3);
  assert.equal(Number(s.tax_threshold_gr), 10000000);
  assert.equal(Number(s.vat_limit_gr), 24000000);
  assert.equal(s.default_last_period, 'proporcjonalnie');
});

test('zapisz_pakiet: nowy najem (klient, umowa, najem, stawka, kaucja) w jednej transakcji', async () => {
  await jako(A);
  const id = { u: crypto.randomUUID(), k: crypto.randomUUID(), c: crypto.randomUUID(), r: crypto.randomUUID() };
  const pakiet = {
    units: [{ id: id.u, code: 'B-12', type: 'box_duzy', list_price_gr: 15000 }],
    clients: [{ id: id.k, name: 'Anna Kowalska', opening_balance_gr: -30000 }],
    contracts: [{ id: id.c, client_id: id.k, number: 'U/2/2026', signed_on: '2026-03-30' }],
    rentals: [{ id: id.r, contract_id: id.c, unit_id: id.u, start_on: '2026-04-01', billing_day: 1 }],
    rental_rates: [{ rental_id: id.r, valid_from: '2026-04-01', amount_gr: 15000, reason: 'start' }],
    deposits: [{ contract_id: id.c, kind: 'przyjecie', amount_gr: 50000, on_date: '2026-03-30' }],
  };
  const { rows: [{ w }] } = await db.query('select public.zapisz_pakiet($1) as w', [pakiet]);
  assert.equal(w.units[0].user_id, A, 'user_id z auth.uid()');
  assert.equal(w.rentals[0].period_months, 1, 'wartości domyślne');
  assert.equal(w.rentals[0].last_period, 'proporcjonalnie');
  assert.equal(w.clients[0].opening_balance_gr, -30000);
  assert.equal(w.deposits[0].method, 'gotowka');
  assert.equal(w.rental_rates.length, 1);
  assert.deepEqual(w.payments, []);
});

test('zapisz_pakiet: błąd w jednym wierszu cofa cały pakiet (7.5: wszystko albo nic)', async () => {
  await jako(A);
  const unit = (await db.query("select id from units where code = 'B-12'")).rows[0].id;
  const contract = (await db.query("select id from contracts where number = 'U/2/2026'")).rows[0].id;
  const pakiet = {
    clients: [{ name: 'Nie powinien powstać' }],
    rentals: [{ contract_id: contract, unit_id: unit, start_on: '2026-05-01', billing_day: 1 }],   // nakłada się
  };
  await assert.rejects(db.query('select public.zapisz_pakiet($1)', [pakiet]), /rentals_no_overlap/);
  const { rows } = await db.query("select 1 from clients where name = 'Nie powinien powstać'");
  assert.equal(rows.length, 0);
});

test('zapisz_pakiet: zakończenie najmu i zatrzymanie kaucji na zaległy czynsz', async () => {
  await jako(A);
  const najem = (await db.query("select r.id, r.unit_id, r.contract_id, c.client_id from rentals r join contracts c on c.id = r.contract_id where c.number = 'U/2/2026'")).rows[0];
  const wplata = crypto.randomUUID();
  const { rows: [{ w }] } = await db.query('select public.zapisz_pakiet($1) as w', [{
    rentals_end: [{ id: najem.id, end_on: '2026-09-30', last_period: 'pelny' }],
    // ta sama jednostka od razu dostaje kolejny najem – kolejność w funkcji to umożliwia
    rentals: [{ contract_id: najem.contract_id, unit_id: najem.unit_id, start_on: '2026-10-01', billing_day: 1 }],
    payments: [{ id: wplata, booked_on: '2026-09-30', amount_gr: 20000, kind: 'czynsz', method: 'kaucja',
      client_id: najem.client_id, contract_id: najem.contract_id, match_method: 'reczne', match_confirmed: true }],
    deposits: [{ contract_id: najem.contract_id, kind: 'zatrzymanie', amount_gr: 20000, on_date: '2026-09-30',
      reason: 'zaległy czynsz', payment_id: wplata }],
  }]);
  assert.equal(w.rentals.length, 2, 'zmieniony i nowy najem');
  assert.equal(w.rentals[0].end_on, '2026-09-30');
  assert.equal(w.rentals[0].last_period, 'pelny');
  assert.equal(w.deposits[0].payment_id, wplata);
});

test('zapisz_pakiet: RLS obowiązuje także w funkcji, anon nie może jej wywołać', async () => {
  await jako(B);
  const obca = (await db.query('select count(*)::int as n from units')).rows[0].n;
  await db.query('select public.zapisz_pakiet($1)', [{ units: [{ code: 'K-01', type: 'kontener' }] }]);
  assert.equal((await db.query('select count(*)::int as n from units')).rows[0].n, obca + 1);
  // user_id podany w pakiecie jest pomijany – wiersz zawsze dostaje zalogowanego użytkownika
  await db.query('select public.zapisz_pakiet($1)', [{ units: [{ user_id: A, code: 'K-02', type: 'kontener' }] }]);
  const { rows } = await db.query("select user_id from units where code = 'K-02'");
  assert.deepEqual(rows.map((r) => r.user_id), [B]);

  await db.exec('reset role');
  await db.exec('set role anon');
  await oczekujBledu('select public.zapisz_pakiet($1)', [{}], /permission denied/);
  await db.exec('reset role');
});

test('storage: bucket umowy prywatny, PDF do 10 MB, pliki tylko we własnym folderze', async () => {
  await db.exec('reset role');
  const { rows: [b] } = await db.query("select * from storage.buckets where id = 'umowy'");
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 10 * 1024 * 1024);
  assert.deepEqual(b.allowed_mime_types, ['application/pdf']);

  await jako(A);
  await db.query("insert into storage.objects (bucket_id, name) values ('umowy', $1)", [`${A}/umowa.pdf`]);
  await oczekujBledu("insert into storage.objects (bucket_id, name) values ('umowy', $1)", [`${B}/umowa.pdf`],
    /row-level security/);
});

test('migracja 001: stare ograniczenie typu (3 typy) zmienia na 4 typy; typ „box” w danych zatrzymuje migrację', async () => {
  const migracja = await readFile(new URL('001_zapisz_pakiet.sql', MIGRACJE), 'utf8');
  await db.exec('reset role');
  // stan jak po pierwszej wersji schematu: check z typem „box” (not valid – w tabeli są już boxy duże)
  await db.exec(`alter table units drop constraint units_type_check;
    alter table units add constraint units_type_check check (type in ('kontener', 'garaz', 'box')) not valid`);
  await db.exec(migracja);
  const { rows: [c] } = await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'units_type_check'`);
  assert.match(c.def, /box_duzy.*box_maly/);

  await db.exec(`alter table units drop constraint units_type_check;
    insert into units (user_id, code, type) values ('${A}', 'B-STARY', 'box')`);
  await assert.rejects(db.exec(migracja), /typem spoza listy/);
  await db.exec(`delete from units where code = 'B-STARY'`);
  await db.exec(migracja);
});

/** Kopia jak z aplikacji: wszystkie wiersze użytkownika z każdej tabeli. */
async function kopiaUzytkownika(userId) {
  const p = {};
  for (const t of TABELE) p[t] = (await db.query(`select to_jsonb(x) as w from ${t} x where user_id = $1`, [userId])).rows.map((r) => r.w);
  return p;
}

test('wczytaj_kopie: zastępuje dane użytkownika kopią, nadpisuje user_id, nie rusza innych kont', async () => {
  await jako(A);
  await db.exec('reset role');
  const liczbaB = (await db.query('select count(*)::int as n from units where user_id = $1', [B])).rows[0].n;
  await jako(A);
  const kopia = await kopiaUzytkownika(A);
  assert.ok(kopia.units.length > 0 && kopia.rentals.length > 0 && kopia.payments.length > 0, 'są dane do kopii');
  // zmiany po zrobieniu kopii – po wczytaniu mają zniknąć
  await db.query("insert into units (code, type) values ('PO-KOPII', 'garaz')");
  await db.query("update settings set tolerance_days = 9 where user_id = $1", [A]);
  // wiersz z cudzym user_id w pliku – funkcja i tak zapisze go jako A
  kopia.client_notes = [...kopia.client_notes, { id: crypto.randomUUID(), user_id: B, client_id: kopia.clients[0].id,
    kind: 'notatka', body: 'z kopii', created_at: '2026-11-11T08:00:00Z' }];

  const { rows: [{ w }] } = await db.query('select public.wczytaj_kopie($1) as w', [kopia]);
  assert.equal(w.units, kopia.units.length);
  assert.equal(w.payments, kopia.payments.length);
  const { rows: jednostki } = await db.query("select 1 from units where code = 'PO-KOPII'");
  assert.equal(jednostki.length, 0, 'zmiany po kopii zniknęły');
  assert.equal((await db.query('select tolerance_days from settings')).rows[0].tolerance_days, kopia.settings[0].tolerance_days);
  assert.equal((await db.query("select user_id from client_notes where body = 'z kopii'")).rows[0].user_id, A);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from units where user_id = $1', [B])).rows[0].n, liczbaB, 'konto B bez zmian');
});

test('wczytaj_kopie: błąd w kopii cofa wszystko (dane sprzed wczytania zostają)', async () => {
  await jako(A);
  const kopia = await kopiaUzytkownika(A);
  const przed = (await db.query('select count(*)::int as n from rentals')).rows[0].n;
  const zla = { ...kopia, rentals: [...kopia.rentals, { ...kopia.rentals[0], id: crypto.randomUUID() }] };   // nakładający się najem
  await assert.rejects(db.query('select public.wczytaj_kopie($1)', [zla]), /rentals_no_overlap/);
  assert.equal((await db.query('select count(*)::int as n from rentals')).rows[0].n, przed);
  await jako('');   // sesja bez zalogowanego użytkownika: auth.uid() = null
  await oczekujBledu('select public.wczytaj_kopie($1)', [kopia], /Brak zalogowanego/);
});
