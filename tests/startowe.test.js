import { test } from 'node:test';
import assert from 'node:assert/strict';
import { przygotujImport, SZABLONY } from '../js/startowe.js';
import { DOMYSLNE_USTAWIENIA } from '../js/config.js';

const DZIS = '2026-11-09';
const pusteDane = () => ({ units: [], clients: [], contracts: [], rentals: [], deposits: [], payments: [] });
let n = 0;
const kontekst = (dane = pusteDane()) => ({ dane, ustawienia: DOMYSLNE_USTAWIENIA, dzis: DZIS, noweId: () => `id-${++n}` });
const plik = (rodzaj, ...wiersze) => [SZABLONY[rodzaj].kolumny.join(';'), ...wiersze].join('\n');

const JEDNOSTKI = plik('jednostki', 'G-03;garaż;18,5;300;', 'B-12;Duży box;;150;', 'K-01;kontener;;;przy bramie');
const KLIENCI = plik('klienci',
  'osoba;Jan Nowak;;;;600100200;;-300;', 'firma;Magazyny Sp. z o.o.;Anna Kowalska;5260250274;;;;;');
const NAJMY = plik('najmy',
  'Jan Nowak;G-03;U/1/2024;10.03.2024;15.03.2024;;;;300;500;gotówka;',
  'Jan Nowak;B-12;U/1/2024;10.03.2024;01.04.2024;;;1;150;;;',
  '5260250274;K-01;;;2025-06-01;2026-05-31;2026-05-31;;400;;;');
const WPLATY = plik('wplaty_gotowka', '15.02.2026;Jan Nowak;300;za luty', '2026-03-15;Jan Nowak;300,00;');

test('pełny import: jednostki, klienci, najmy z umowami i kaucją, wpłaty gotówkowe', () => {
  const { bledy, pakiet, liczby } = przygotujImport(
    { jednostki: JEDNOSTKI, klienci: KLIENCI, najmy: NAJMY, wplaty_gotowka: WPLATY }, kontekst());
  assert.deepEqual(bledy, []);
  assert.deepEqual(liczby, { units: 3, clients: 2, contracts: 2, rentals: 3, rental_rates: 3, deposits: 1, payments: 2 });
  assert.deepEqual(pakiet.units.map((u) => [u.code, u.type, u.list_price_gr]), [['G-03', 'garaz', 30000], ['B-12', 'box_duzy', 15000], ['K-01', 'kontener', null]]);
  assert.equal(pakiet.clients[0].opening_balance_gr, -30000);
  assert.equal(pakiet.clients[1].kind, 'firma');

  const [r1, r2, r3] = pakiet.rentals;
  assert.equal(r1.contract_id, r2.contract_id, 'ten sam numer umowy = jedna umowa z dwiema jednostkami');
  assert.equal(r1.billing_day, 20, 'dzień płatności z ustawień (20.), nie z daty startu');
  assert.equal(r3.end_on, '2026-05-31');
  assert.equal(pakiet.contracts[1].client_id, pakiet.clients[1].id, 'klient znaleziony po NIP');
  assert.deepEqual(pakiet.deposits, [{ contract_id: r1.contract_id, kind: 'przyjecie', amount_gr: 50000, method: 'gotowka', on_date: '2024-03-10' }]);
  assert.deepEqual(pakiet.rental_rates[0], { rental_id: r1.id, valid_from: '2024-03-15', amount_gr: 30000, reason: 'start' });
  assert.deepEqual(pakiet.payments[0], { booked_on: '2026-02-15', amount_gr: 30000, kind: 'czynsz', method: 'gotowka',
    client_id: pakiet.clients[0].id, match_method: 'reczne', match_confirmed: true, note: 'za luty' });
});

test('walidacja 7.5: błędy z numerem wiersza – nieznana jednostka i klient, błędny NIP, data, ujemna stawka', () => {
  const { bledy } = przygotujImport({
    jednostki: plik('jednostki', 'G-03;garaż;;;', 'G-03;garaż;;;', 'X-1;box;;;', 'S01XS;box_maly;2,94;;'),
    klienci: plik('klienci', 'firma;Firma;;1234567890;;;;;'),
    najmy: plik('najmy', 'Ktoś;G-03;;;15.03.2024;;;;300;;;', 'Firma;Z-99;;;31.02.2024;;;;-5;;;'),
    wplaty_gotowka: plik('wplaty_gotowka', '15.12.2025;Firma;300;'),
  }, kontekst());
  const opis = bledy.map((b) => `${b.plik}:${b.nr} ${b.powod}`);
  assert.ok(opis.includes('jednostki.csv:3 numer: Jednostka G-03 już istnieje.'), 'duplikat w pliku');
  assert.ok(opis.some((t) => t.startsWith('jednostki.csv:4 typ: nieznany typ „box” – wpisz garaż, kontener, box_duzy albo box_maly')),
    'samo „box” jest niejednoznaczne (decyzja 3)');
  assert.ok(!opis.some((t) => t.startsWith('jednostki.csv:5')), 'box_maly z kodem S01XS poprawny');
  assert.ok(opis.some((t) => t.startsWith('klienci.csv:2 nip:')));
  assert.ok(opis.includes('najmy.csv:2 klient: nie ma klienta „Ktoś”.'));
  assert.ok(opis.includes('najmy.csv:3 jednostka: nie ma jednostki „Z-99”.'));
  assert.ok(opis.some((t) => t.startsWith('najmy.csv:3 data_startu: „31.02.2024” to nie data')));
  assert.ok(opis.some((t) => t.startsWith('najmy.csv:3 stawka:')));
  assert.ok(opis.some((t) => t.startsWith('wplaty_gotowka.csv:2 data: wpłata musi być od 01.01.2026')));
});

test('nakładające się najmy tej samej jednostki – w pliku i względem bazy (test 16)', () => {
  const dane = pusteDane();
  dane.units = [{ id: 'u1', code: 'G-03' }, { id: 'u2', code: 'B-12' }];
  dane.clients = [{ id: 'k1', name: 'Jan Nowak' }];
  dane.rentals = [{ id: 'r1', unit_id: 'u2', start_on: '2025-01-01', end_on: null }];
  const { bledy } = przygotujImport({ najmy: plik('najmy',
    'Jan Nowak;G-03;;;01.01.2025;;30.06.2025;;300;;;',
    'Jan Nowak;G-03;;;30.06.2025;;;;300;;;',
    'Jan Nowak;G-03;;;01.07.2025;;;;300;;;',
    'Jan Nowak;B-12;;;01.06.2026;;;;150;;;') }, kontekst(dane));
  assert.deepEqual(bledy.map((b) => [b.nr, b.powod]), [
    [3, 'jednostka G-03: najem nakłada się z wierszem 2.'],
    [5, 'jednostka B-12: w bazie jest już najem od 01.01.2025.'],
  ]);
});

test('ponowny import: istniejący klient, umowa z kaucją i ta sama wpłata gotówkowa są wykrywane', () => {
  const dane = pusteDane();
  dane.units = [{ id: 'u1', code: 'G-03' }];
  dane.clients = [{ id: 'k1', name: 'Jan Nowak' }];
  dane.contracts = [{ id: 'c1', client_id: 'k1', number: 'U/1/2024' }];
  dane.deposits = [{ contract_id: 'c1', kind: 'przyjecie', amount_gr: 50000 }];
  dane.payments = [{ method: 'gotowka', client_id: 'k1', booked_on: '2026-02-15', amount_gr: 30000 }];
  const { bledy, pakiet } = przygotujImport({
    klienci: plik('klienci', 'osoba;jan nowak;;;;;;;'),
    najmy: plik('najmy', 'Jan Nowak;G-03;U/1/2024;;15.03.2024;;;;300;500;;'),
    wplaty_gotowka: plik('wplaty_gotowka', '15.02.2026;Jan Nowak;300;'),
  }, kontekst(dane));
  assert.deepEqual(bledy.map((b) => b.nr + ' ' + b.powod.split(' ')[0]), ['2 nazwa:', '2 kaucja:', '2 taka']);
  assert.equal(pakiet.contracts.length, 0, 'umowa z bazy użyta ponownie');
  assert.equal(pakiet.rentals[0].contract_id, 'c1');
});

test('brak wymaganej kolumny i pusty plik', () => {
  const { bledy } = przygotujImport({ jednostki: 'numer;opis\nG-03;x', klienci: SZABLONY.klienci.kolumny.join(';') }, kontekst());
  assert.deepEqual(bledy.map((b) => [b.plik, b.nr]), [['jednostki.csv', 1], ['klienci.csv', 2]]);
  assert.match(bledy[0].powod, /Brak kolumny „typ”/);
});
