// Test schematu bazy na prawdziwym PostgreSQL (PGlite, WASM).
// Uruchomienie: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const TABELE = ['units', 'clients', 'contracts', 'rentals', 'rental_rates', 'charge_adjustments',
  'bank_accounts', 'imports', 'payments', 'payers', 'deposits', 'client_notes',
  'tax_payments', 'settings'];

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

before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  const stub = await readFile(new URL('./supabase-stub.sql', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await db.exec(stub);
  await db.exec(schema);
});

test('schemat ma 14 tabel, każda z RLS i polityką own_rows', async () => {
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
  await oczekujBledu("insert into units (user_id, code, type) values ($1, 'X-1', 'box')", [A],
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
