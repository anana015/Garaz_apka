import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujIndeksy } from '../js/dane.js';
import { naleznosciNajmu, pierwszyOkresOd } from '../js/okresy.js';
import {
  walidujJednostke, walidujKlienta, walidujNajem, kolizjaNajmu, walidujPdf, nowaStawka, walidujZmianeStawki,
  walidujPodwyzke, saldoKaucji, walidujKoniec, walidujKorekte, walidujUstawienia, walidujKonto, walidujKaucje,
} from '../js/walidacja.js';
import { DOMYSLNE_USTAWIENIA } from '../js/config.js';

const DZIS = '2026-11-09';
const dane = {
  units: [
    { id: 'u1', code: 'G-03', type: 'garaz', list_price_gr: 30000 },
    { id: 'u2', code: 'B-12', type: 'box_duzy', list_price_gr: 15000 },
    { id: 'u3', code: 'K-01', type: 'kontener', out_of_service: true },
    { id: 'u4', code: 'G-07', type: 'garaz', list_price_gr: 15000 },
  ],
  clients: [{ id: 'k1', name: 'Jan Nowak', nip: '5260250274' }, { id: 'k2', name: 'Anna Kowalska' }],
  contracts: [{ id: 'c1', client_id: 'k1', number: 'U/1/2026' }],
  rentals: [{ id: 'r1', contract_id: 'c1', unit_id: 'u1', start_on: '2026-03-15', end_on: null, billing_day: 15,
    period_months: 1, last_period: 'proporcjonalnie' }],
  rental_rates: [{ rental_id: 'r1', valid_from: '2026-03-15', amount_gr: 30000 }],
  bank_accounts: [],
};
const indeksy = zbudujIndeksy(dane);
let licznik = 0;
const noweId = () => `id-${++licznik}`;

test('jednostka: numer unikalny bez względu na wielkość liter, do 12 znaków, typ wymagany', () => {
  assert.equal(walidujJednostke({ code: 'g-03', type: 'garaz' }, { jednostki: dane.units }).bledy.code, 'Jednostka G-03 już istnieje.');
  assert.ok(!walidujJednostke({ code: 'g-03', type: 'garaz' }, { jednostki: dane.units, id: 'u1' }).bledy.code, 'edycja tej samej');
  assert.ok(walidujJednostke({ code: 'GARAZ-NUMER-13', type: 'garaz' }).bledy.code);
  assert.ok(walidujJednostke({ code: 'G-04', type: 'magazyn' }).bledy.type);
  const { bledy, wiersz } = walidujJednostke({ code: ' g-04 ', type: 'garaz', area_m2: '18,5', list_price_gr: '320' });
  assert.deepEqual(bledy, {});
  assert.deepEqual([wiersz.code, wiersz.area_m2, wiersz.list_price_gr, wiersz.out_of_service], ['G-04', 18.5, 32000, false]);
  assert.ok(walidujJednostke({ code: 'G-03', type: 'garaz', out_of_service: 'on' }, { id: 'u1', jednostki: dane.units, wynajeta: true })
    .bledy.out_of_service, 'wynajętej nie wyłączamy');
});

test('klient: nazwa do 80 znaków, NIP z sumą kontrolną i bez duplikatu, telefon, e-mail, saldo otwarcia', () => {
  assert.equal(walidujKlienta({ kind: 'firma' }).bledy.name, 'Podaj nazwę firmy.');
  assert.ok(walidujKlienta({ name: 'x'.repeat(81) }).bledy.name);
  assert.ok(walidujKlienta({ name: 'A', nip: '1234567890' }).bledy.nip);
  assert.match(walidujKlienta({ name: 'B', nip: '526-025-02-74' }, { klienci: dane.clients }).bledy.nip, /Jan Nowak/);
  assert.ok(walidujKlienta({ name: 'A', phone: '12345' }).bledy.phone);
  assert.ok(walidujKlienta({ name: 'A', email: 'jan@' }).bledy.email);
  const { bledy, wiersz } = walidujKlienta({ name: '  Jan   Kowalski ', phone: '+48 600 100 200', opening_balance_gr: '-120,50', email: '' });
  assert.deepEqual(bledy, {});
  assert.deepEqual([wiersz.name, wiersz.kind, wiersz.opening_balance_gr, wiersz.email], ['Jan Kowalski', 'osoba', -12050, null]);
});

test('najem: jednostka wolna od daty startu, kolizje opisane, wyłączona jednostka odrzucona (test 16)', () => {
  const baza = { client_id: 'k2', start_on: '2026-11-15', amount_gr: '300' };
  const ctx = { indeksy, ustawienia: DOMYSLNE_USTAWIENIA, noweId };
  assert.match(walidujNajem({ ...baza, unit_id: 'u1' }, ctx).bledy.unit_id, /G-03 jest wynajęta od 15\.03\.2026 \(Jan Nowak\)\. Najpierw zakończ/);
  assert.match(walidujNajem({ ...baza, unit_id: 'u3' }, ctx).bledy.unit_id, /wyłączona z najmu/);
  assert.equal(kolizjaNajmu([{ id: 'x', start_on: '2026-01-01', end_on: '2026-10-31' }], '2026-11-01'), null, 'styk dzień po dniu');
  assert.ok(kolizjaNajmu([{ id: 'x', start_on: '2027-01-01', end_on: null }], '2026-11-01'), 'późniejszy najem też koliduje');
});

test('najem: pakiet z nową umową, stawką od startu, kaucją; dzień płatności z ustawień', () => {
  const { bledy, pakiet } = walidujNajem({
    client_id: 'k2', unit_id: 'u4', number: 'U/7/2026', signed_on: '2026-11-08', start_on: '2026-11-10',
    amount_gr: '150', billing_day: '', period_months: '1', deposit_gr: '300', deposit_method: 'gotowka',
  }, { indeksy, ustawienia: DOMYSLNE_USTAWIENIA, noweId });
  assert.deepEqual(bledy, {});
  const [umowa] = pakiet.contracts;
  const [najem] = pakiet.rentals;
  assert.equal(najem.contract_id, umowa.id);
  assert.equal(najem.billing_day, 20, 'puste pole = dzień z ustawień (20.), nie z daty startu');
  assert.equal(najem.last_period, 'proporcjonalnie', 'domyślnie z Ustawień');
  assert.deepEqual(pakiet.rental_rates, [{ rental_id: najem.id, valid_from: '2026-11-10', amount_gr: 15000, reason: 'start' }]);
  assert.deepEqual(pakiet.deposits[0], { contract_id: umowa.id, kind: 'przyjecie', amount_gr: 30000, method: 'gotowka', on_date: '2026-11-08' });
});

test('najem boxu: bez kaucji, nawet gdy pole kaucji jest wypełnione', () => {
  const { bledy, pakiet } = walidujNajem({
    client_id: 'k2', unit_id: 'u2', start_on: '2026-11-10', amount_gr: '150', deposit_gr: 'abc', deposit_method: 'gotowka',
  }, { indeksy, ustawienia: DOMYSLNE_USTAWIENIA, noweId });
  assert.deepEqual(bledy, {});
  assert.deepEqual(pakiet.deposits, []);
});

test('kaucja dopisana później: umowa, kwota > 0, data nie w przyszłości', () => {
  const umowy = [{ id: 'c1' }];
  assert.deepEqual(walidujKaucje({ contract_id: 'c1', amount_gr: '300', on_date: '2026-11-01', method: 'przelew' }, { umowy, dzis: DZIS }),
    { bledy: {}, wiersz: { contract_id: 'c1', kind: 'przyjecie', amount_gr: 30000, method: 'przelew', on_date: '2026-11-01' } });
  const zle = walidujKaucje({ contract_id: 'x', amount_gr: '0', on_date: '2026-12-01' }, { umowy, dzis: DZIS });
  assert.deepEqual(Object.keys(zle.bledy).sort(), ['amount_gr', 'contract_id', 'on_date']);
  assert.equal(zle.wiersz, null);
});

test('najem: ten sam numer umowy u klienta dopisuje jednostkę do istniejącej umowy', () => {
  const { pakiet, istniejacaUmowa } = walidujNajem({
    client_id: 'k1', unit_id: 'u2', number: 'u/1/2026', start_on: '2026-11-01', amount_gr: '150',
  }, { indeksy, ustawienia: DOMYSLNE_USTAWIENIA, noweId });
  assert.equal(istniejacaUmowa.id, 'c1');
  assert.deepEqual(pakiet.contracts, []);
  assert.equal(pakiet.rentals[0].contract_id, 'c1');
});

test('PDF umowy: tylko PDF do 10 MB', () => {
  assert.equal(walidujPdf(null), null);
  assert.equal(walidujPdf({ name: 'umowa.pdf', size: 1000, type: 'application/pdf' }), null);
  assert.match(walidujPdf({ name: 'skan.jpg', size: 1000, type: 'image/jpeg' }), /PDF/);
  assert.match(walidujPdf({ name: 'umowa.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' }), /10 MB/);
});

test('nowa stawka: kwota, procent i złote, zaokrąglenie do pełnych złotych', () => {
  assert.equal(nowaStawka(30000, 'kwota', 33000), 33000);
  assert.equal(nowaStawka(30000, 'procent', 1000), 33000);
  assert.equal(nowaStawka(31500, 'procent', 500), 33100, '330,75 → 331 zł');
  assert.equal(nowaStawka(31500, 'procent', 500, false), 33075);
  assert.equal(nowaStawka(30000, 'zl', 2550), 32600, '325,50 → 326 zł');
});

test('zmiana stawki jednego najmu: Z13 – pierwszy okres zaczynający się „od” lub później (test 1)', () => {
  const najem = dane.rentals[0];
  const { bledy, wiersz, podglad } = walidujZmianeStawki(
    { valid_from: '2026-07-01', tryb: 'kwota', wartosc: '330', zaokraglij: 'on' }, { najem, stawki: dane.rental_rates });
  assert.deepEqual(bledy, {});
  assert.equal(podglad.pierwszyOkres, '2026-07-01', 'okresy kalendarzowe (11.11)');
  assert.deepEqual(wiersz, { rental_id: 'r1', valid_from: '2026-07-01', amount_gr: 33000, reason: 'podwyżka' });
  assert.match(walidujZmianeStawki({ valid_from: '2026-03-01', wartosc: '330' }, { najem, stawki: dane.rental_rates }).bledy.valid_from,
    /przed startem/);
  assert.ok(walidujZmianeStawki({ valid_from: '2026-07-01', tryb: 'procent', wartosc: '-100' }, { najem, stawki: dane.rental_rates })
    .bledy.wartosc, 'stawka 0 zł odrzucona');
});

test('zmiana stawki: ta sama data zastępuje stawkę, a „stara” to poprzednia', () => {
  const stawki = [...dane.rental_rates, { rental_id: 'r1', valid_from: '2026-07-01', amount_gr: 31000 }];
  const { podglad } = walidujZmianeStawki({ valid_from: '2026-07-01', tryb: 'procent', wartosc: '10', zaokraglij: 'on' },
    { najem: dane.rentals[0], stawki });
  assert.deepEqual([podglad.zastepuje, podglad.staraGr, podglad.nowaGr], [true, 30000, 33000]);
});

test('podwyżka zbiorcza: tylko zaznaczone najmy, podgląd wszystkich, błąd blokuje zapis', () => {
  const najmy = [
    dane.rentals[0],
    { id: 'r2', unit_id: 'u2', start_on: '2026-12-01', end_on: null, billing_day: 1, period_months: 1 },
  ];
  const stawkiNajmu = new Map([['r1', dane.rental_rates], ['r2', [{ valid_from: '2026-12-01', amount_gr: 15000 }]]]);
  const w = { valid_from: '2027-01-01', tryb: 'procent', wartosc: '5', zaokraglij: 'on', najmy: ['r1', 'r2'] };
  const ok = walidujPodwyzke(w, { najmy, stawkiNajmu });
  assert.deepEqual(ok.bledy, {});
  assert.deepEqual(ok.wiersze.map((x) => x.amount_gr), [31500, 15800], '157,50 → 158 zł');
  assert.deepEqual(ok.pozycje.map((p) => p.pierwszyOkres), ['2027-01-01', '2027-01-01']);

  const czesc = walidujPodwyzke({ ...w, najmy: 'r2' }, { najmy, stawkiNajmu });
  assert.equal(czesc.wiersze.length, 1, 'pojedyncza wartość z FormData');
  const zle = walidujPodwyzke({ ...w, valid_from: '2026-11-15' }, { najmy, stawkiNajmu });
  assert.ok(zle.bledy.najmy, 'r2 startuje po dacie – błąd w zaznaczonym');
  assert.equal(zle.wiersze.length, 0);
  assert.ok(walidujPodwyzke({ ...w, najmy: [] }, { najmy, stawkiNajmu }).bledy.najmy);
});

test('saldo kaucji umowy: przyjęcie − zwrot − zatrzymanie', () => {
  const ruchy = [
    { contract_id: 'c1', kind: 'przyjecie', amount_gr: 50000, method: 'gotowka' },
    { contract_id: 'c1', kind: 'zatrzymanie', amount_gr: 20000 },
    { contract_id: 'c2', kind: 'przyjecie', amount_gr: 10000, method: 'przelew' },
  ];
  assert.deepEqual(saldoKaucji(ruchy, 'c1'), { saldoGr: 30000, metoda: 'gotowka' });
  assert.deepEqual(saldoKaucji(ruchy, 'c3'), { saldoGr: 0, metoda: 'gotowka' });
});

test('zakończenie najmu: test 3 (176 zł / pełny okres 330 zł), zwrot + zatrzymanie ≤ kaucja (test 13)', () => {
  const najem = dane.rentals[0];
  const stawki = [...dane.rental_rates, { rental_id: 'r1', valid_from: '2026-07-01', amount_gr: 33000 }];
  const ctx = { najem, umowa: dane.contracts[0], stawki, ustawienia: DOMYSLNE_USTAWIENIA, dzis: DZIS, noweId,
    kaucja: { saldoGr: 50000, metoda: 'gotowka' } };

  const prop = walidujKoniec({ end_on: '2026-09-15', last_period: 'proporcjonalnie' }, ctx);
  assert.deepEqual(prop.bledy, {});
  assert.equal(prop.ostatniaNaleznosc.kwotaGr, 16500, '330 × 15 ÷ 30 (wrzesień)');
  assert.deepEqual(prop.pakiet.rentals_end, [{ id: 'r1', end_on: '2026-09-15', last_period: 'proporcjonalnie' }]);
  assert.equal(walidujKoniec({ end_on: '2026-09-15', last_period: 'pelny' }, ctx).ostatniaNaleznosc.kwotaGr, 33000);

  assert.match(walidujKoniec({ end_on: '2026-09-30', zwrot_gr: '400', zatrzymanie_gr: '200', zatrzymanie_powod: 'czynsz' }, ctx)
    .bledy.zwrot_gr, /nie mogą przekroczyć kaucji \(500,00/);
  const { bledy, pakiet } = walidujKoniec({ end_on: '2026-09-30', zwrot_gr: '300', zatrzymanie_gr: '200',
    zatrzymanie_powod: 'czynsz' }, ctx);
  assert.deepEqual(bledy, {});
  const [wplata] = pakiet.payments;
  assert.deepEqual([wplata.kind, wplata.method, wplata.amount_gr, wplata.client_id], ['czynsz', 'kaucja', 20000, 'k1']);
  assert.deepEqual(pakiet.deposits.map((d) => [d.kind, d.amount_gr]), [['zwrot', 30000], ['zatrzymanie', 20000]]);
  assert.equal(pakiet.deposits[1].payment_id, wplata.id);
  assert.equal(walidujKoniec({ end_on: '2026-09-30', zatrzymanie_gr: '100', zatrzymanie_powod: 'szkody' }, ctx)
    .pakiet.payments[0].kind, 'przychod_inny');
  assert.ok(walidujKoniec({ end_on: '2026-03-01' }, ctx).bledy.end_on, 'przed startem');
  assert.ok(walidujKoniec({ end_on: '2027-02-01' }, { ...ctx, najmyJednostki: [najem,
    { id: 'r9', start_on: '2027-01-01' }] }).bledy.end_on, 'kolejny najem tej jednostki');
});

test('korekta należności: okres z listy, powód wymagany, wynik okresu ≥ 0', () => {
  const najem = dane.rentals[0];
  const naleznosci = naleznosciNajmu(najem, { stawki: dane.rental_rates, dataStart: '2026-01-01', dzis: DZIS });
  assert.ok(walidujKorekte({ period_start: '2026-03-16', amount_gr: '-50', reason: 'x' }, { najem, naleznosci }).bledy.period_start);
  assert.ok(walidujKorekte({ period_start: '2026-04-01', amount_gr: '-50' }, { najem, naleznosci }).bledy.reason);
  assert.match(walidujKorekte({ period_start: '2026-04-01', amount_gr: '-301', reason: 'rabat' }, { najem, naleznosci })
    .bledy.amount_gr, /−300,00/);
  const { bledy, wiersz } = walidujKorekte({ period_start: '2026-04-01', amount_gr: '-50', reason: 'awaria bramy' }, { najem, naleznosci });
  assert.deepEqual(bledy, {});
  assert.deepEqual(wiersz, { rental_id: 'r1', period_start: '2026-04-01', amount_gr: -5000, reason: 'awaria bramy' });
});

test('korekta „ustaw kwotę należności”: różnica do obecnej kwoty, domyślny powód, ta sama kwota = błąd', () => {
  const najem = dane.rentals[0];
  const naleznosci = naleznosciNajmu(najem, { stawki: dane.rental_rates, dataStart: '2026-01-01', dzis: DZIS });
  const okres = naleznosci.find((n) => n.poczatek === '2026-04-01');
  const { bledy, wiersz } = walidujKorekte({ tryb: 'kwota', period_start: '2026-04-01', nowa_kwota: '120' }, { najem, naleznosci });
  assert.deepEqual(bledy, {});
  assert.equal(wiersz.amount_gr, 12000 - okres.kwotaGr);
  assert.equal(wiersz.reason, 'Ręczna kwota okresu');
  assert.ok(walidujKorekte({ tryb: 'kwota', period_start: '2026-04-01', nowa_kwota: String(okres.kwotaGr / 100) },
    { najem, naleznosci }).bledy.nowa_kwota);
  assert.ok(walidujKorekte({ tryb: 'kwota', period_start: '2026-04-01', nowa_kwota: '-5' }, { najem, naleznosci }).bledy.nowa_kwota);
});

test('ustawienia i konto bankowe', () => {
  const w = { tolerance_days: '3', punctuality_months: '12', expiring_days: '30', default_billing_day: '20', tax_rate_low_bp: '8,5',
    tax_rate_high_bp: '12,5', tax_threshold_gr: '100 000', vat_limit_gr: '240000', data_start: '2026-01-01',
    tax_account: 'PL 61 1090 1014 0000 0712 1981 2874' };
  const { bledy, wiersz } = walidujUstawienia(w, { dzis: DZIS });
  assert.deepEqual(bledy, {});
  assert.deepEqual([wiersz.tax_rate_low_bp, wiersz.tax_threshold_gr, wiersz.tax_account],
    [850, 10000000, '61109010140000071219812874']);
  assert.ok(walidujUstawienia({ ...w, tolerance_days: '-1' }, { dzis: DZIS }).bledy.tolerance_days);
  assert.ok(walidujUstawienia({ ...w, data_start: '2027-01-01' }, { dzis: DZIS }).bledy.data_start);

  assert.ok(walidujKonto({ name: '', bank: 'nest' }).bledy.name);
  assert.ok(walidujKonto({ name: 'Nest', bank: 'mbank' }).bledy.bank);
  assert.ok(walidujKonto({ name: 'Nest', bank: 'nest', iban: '123' }).bledy.iban);
  assert.deepEqual(walidujKonto({ name: 'Nest – najem', bank: 'nest' }).bledy, {});
});

test('pierwszyOkresOd: okres 3-miesięczny i najem zakończony przed datą', () => {
  const kw = { id: 'q', start_on: '2026-01-10', end_on: null, billing_day: 10, period_months: 3 };
  assert.equal(pierwszyOkresOd(kw, '2026-02-02'), '2026-05-01', 'kwartały od 1. dnia miesiąca: 01.02, 01.05…');
  assert.equal(pierwszyOkresOd(kw, '2025-12-01'), '2026-01-10', 'data przed startem → pierwszy okres');
  assert.equal(pierwszyOkresOd({ ...kw, end_on: '2026-03-31' }, '2026-02-02'), null);
});
