import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatZl, parseKwota, dzisiaj, parseData, dodajDni, roznicaDni, dodajMiesiace,
  formatData, formatDataKrotka, etykietaMiesiaca, zakresMiesiecy, normalizujTekst, esc,
  porownajKody, walidujNip, walidujTelefon, walidujEmail, oczyscRachunek, czytajDate, kwotaDoPola, nastepnyNumer, odmiana, noweId,
} from '../js/utils.js';

const S = ' '; // twarda spacja

test('formatZl: tabele z groszami, kafelki w pełnych złotych (12.4)', () => {
  assert.equal(formatZl(33000), `330,00${S}zł`);
  assert.equal(formatZl(499600, { grosze: false }), `4${S}996${S}zł`);
  assert.equal(formatZl(123456789), `1${S}234${S}567,89${S}zł`);
  assert.equal(formatZl(-1250), `−12,50${S}zł`);
  assert.equal(formatZl(5), `0,05${S}zł`);
  assert.equal(formatZl(0), `0,00${S}zł`);
  assert.equal(formatZl(-40, { grosze: false }), `0${S}zł`, 'bez „−0”');
  assert.equal(formatZl(-150, { grosze: false }), `−2${S}zł`, 'zaokrąglenie symetryczne');
  assert.equal(formatZl(null), '—');
  assert.equal(formatZl(33000, { waluta: false }), '330,00');
});

test('parseKwota: test 9 – „1 234,56” to 123456 groszy', () => {
  assert.equal(parseKwota('1 234,56'), 123456);
  assert.equal(parseKwota(`1${S}234,56`), 123456);
});

test('parseKwota: różne formaty banków i formularzy', () => {
  const przypadki = {
    '300': 30000, '300,5': 30050, '-12,50': -1250, '−12,50': -1250, '+900,00': 90000,
    '1234.56': 123456, '1.234,56': 123456, '1,234.56': 123456, '1.234.567': 123456700,
    '300 zł': 30000, '300,00 PLN': 30000, '0,01': 1, '-0,00': 0,
  };
  for (const [tekst, gr] of Object.entries(przypadki)) assert.equal(parseKwota(tekst), gr, tekst);
  for (const zly of ['', 'abc', '12,345', '1,2,3.4.5', '12..5', null, undefined]) {
    assert.equal(parseKwota(zly), null, String(zly));
  }
  assert.equal(parseKwota(12.5), 1250);
});

test('dzisiaj: data w Polsce, także przy zmianie czasu', () => {
  assert.equal(dzisiaj(new Date('2026-03-28T23:30:00Z')), '2026-03-29'); // CET, UTC+1
  assert.equal(dzisiaj(new Date('2026-07-31T22:30:00Z')), '2026-08-01'); // CEST, UTC+2
  assert.equal(dzisiaj(new Date('2026-07-31T21:30:00Z')), '2026-07-31');
});

test('parseData odrzuca nieistniejące daty', () => {
  assert.deepEqual(parseData('2028-02-29'), { y: 2028, m: 2, d: 29 });
  assert.equal(parseData('2027-02-29'), null);
  assert.equal(parseData('2026-13-01'), null);
  assert.equal(parseData('15.10.2026'), null);
});

test('dodajDni i roznicaDni (test 10: termin 05.04 + tolerancja 3)', () => {
  assert.equal(dodajDni('2026-04-05', 3), '2026-04-08');
  assert.equal(dodajDni('2026-12-30', 3), '2027-01-02');
  assert.equal(dodajDni('2026-03-01', -1), '2026-02-28');
  assert.equal(roznicaDni('2026-04-05', '2026-04-10'), 5);
  assert.equal(roznicaDni('2026-03-28', '2026-03-30'), 2, 'zmiana czasu nie psuje różnicy');
});

test('dodajMiesiace: Z5 – dzień 31 w krótszym miesiącu (test 2)', () => {
  assert.equal(dodajMiesiace('2027-01-31', 1), '2027-02-28');
  assert.equal(dodajMiesiace('2027-01-31', 2), '2027-03-31');
  assert.equal(dodajMiesiace('2027-02-28', 1, 31), '2027-03-31', 'dzień płatności 31 wraca w marcu');
  assert.equal(dodajMiesiace('2028-01-30', 1), '2028-02-29');
  assert.equal(dodajMiesiace('2026-03-15', 4), '2026-07-15');
  assert.equal(dodajMiesiace('2026-11-15', 3), '2027-02-15');
  assert.equal(dodajMiesiace('2026-01-15', -1), '2025-12-15');
});

test('formatowanie dat po polsku', () => {
  assert.equal(formatData('2026-10-15'), '15.10.2026');
  assert.equal(formatDataKrotka('2026-10-15'), '15 paź');
  assert.equal(etykietaMiesiaca('2026-11'), 'listopad 2026');
  assert.deepEqual(zakresMiesiecy('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('normalizujTekst: bez ogonków, z literą ł (5.2)', () => {
  assert.equal(normalizujTekst('Łukasz Żółć-Kowalska'), 'LUKASZ ZOLC KOWALSKA');
  assert.equal(normalizujTekst('  P.H.U. „Garaż”  sp. z o.o. '), 'P H U GARAZ SP Z O O');
  assert.equal(normalizujTekst('ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż'), 'ACELNOSZZ ACELNOSZZ');
  assert.equal(normalizujTekst(null), '');
});

test('esc: ucieczka HTML', () => {
  assert.equal(esc('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('porownajKody: sortowanie naturalne numerów jednostek', () => {
  assert.deepEqual(['G-10', 'B-2', 'G-2', 'K-01'].sort(porownajKody), ['B-2', 'G-2', 'G-10', 'K-01']);
});

test('walidacja: NIP z sumą kontrolną, telefon, e-mail, rachunek', () => {
  assert.equal(walidujNip('5260250274'), true);
  assert.equal(walidujNip('526-025-02-74'), true);
  assert.equal(walidujNip('PL5260250274'), true);
  assert.equal(walidujNip('5260250275'), false);
  assert.equal(walidujNip('0000000000'), false);
  assert.equal(walidujNip('123'), false);

  assert.equal(walidujTelefon('600 100 200'), true);
  assert.equal(walidujTelefon('+48 600-100-200'), true);
  assert.equal(walidujTelefon('60010020'), false);

  assert.equal(walidujEmail('jan@firma.pl'), true);
  assert.equal(walidujEmail('jan@firma'), false);

  assert.equal(oczyscRachunek('PL61 1090 1014 0000 0712 1981 2874'), '61109010140000071219812874');
  assert.equal(oczyscRachunek('DE89 3704 0044 0532 0130 00'), null);
});

test('formatery Ustawień i Jednostek: procent, m², rachunek', async () => {
  const { formatProcentBp, formatM2, formatRachunek } = await import('../js/utils.js');
  assert.equal(formatProcentBp(850), '8,5%');
  assert.equal(formatProcentBp(1250), '12,5%');
  assert.equal(formatProcentBp(null), '—');
  assert.equal(formatM2('12.50'), `12,5${S}m²`);
  assert.equal(formatM2(18), `18${S}m²`);
  assert.equal(formatM2(null), '');
  assert.equal(formatRachunek('61109010140000071219812874'), '61 1090 1014 0000 0712 1981 2874');
  assert.equal(formatRachunek('123'), '123', 'niepełny numer bez zmian');
});

test('dataZeZnacznika: znacznik UTC z bazy jako data w Polsce', async () => {
  const { dataZeZnacznika } = await import('../js/utils.js');
  assert.equal(dataZeZnacznika('2026-03-28T23:30:00+00:00'), '2026-03-29');
  assert.equal(dataZeZnacznika('2026-07-31T21:30:00.123456+00:00'), '2026-07-31');
});

test('czytajDate: formaty z formularza i z Excela', () => {
  assert.equal(czytajDate('2026-03-15'), '2026-03-15');
  assert.equal(czytajDate('15.03.2026'), '2026-03-15');
  assert.equal(czytajDate(' 5.3.2026 '), '2026-03-05');
  assert.equal(czytajDate('15/03/2026'), '2026-03-15');
  assert.equal(czytajDate('31.02.2026'), null);
  assert.equal(czytajDate('2026-02-30'), null);
  assert.equal(czytajDate('03/15/2026'), null, 'format amerykański odrzucony');
  assert.equal(czytajDate(''), null);
});

test('kwotaDoPola: grosze do pola formularza i z powrotem', () => {
  assert.equal(kwotaDoPola(33000), '330,00');
  assert.equal(kwotaDoPola(-1250), '-12,50');
  assert.equal(kwotaDoPola(5), '0,05');
  assert.equal(kwotaDoPola(null), '');
  for (const gr of [0, 5, 33000, -1250, 123456789]) assert.equal(parseKwota(kwotaDoPola(gr)), gr);
});

test('nastepnyNumer: podpowiedź numeru przy dodawaniu kolejnych jednostek', () => {
  assert.equal(nastepnyNumer('G-03'), 'G-04');
  assert.equal(nastepnyNumer('G-09'), 'G-10');
  assert.equal(nastepnyNumer('B9'), 'B10');
  assert.equal(nastepnyNumer('K-099'), 'K-100');
  assert.equal(nastepnyNumer('BOX'), '');
  assert.equal(nastepnyNumer('B01XS'), 'B02XS');
  assert.equal(nastepnyNumer('G09R1'), 'G10R1');
});

test('odmiana: 1 najem, 2–4 najmy, 5+ najmów, 12–14 najmów, 22 najmy', () => {
  const f = ['najem', 'najmy', 'najmów'];
  assert.deepEqual([1, 2, 4, 5, 12, 14, 21, 22, 25, 102].map((n) => odmiana(n, f)),
    ['1 najem', '2 najmy', '4 najmy', '5 najmów', '12 najmów', '14 najmów', '21 najmów', '22 najmy', '25 najmów', '102 najmy']);
});

test('noweId: UUID v4, także bez crypto.randomUUID (http w sieci lokalnej)', () => {
  const wzor = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(noweId(), wzor);
  const oryginal = crypto.randomUUID;
  try {
    crypto.randomUUID = undefined;
    const ids = new Set(Array.from({ length: 50 }, () => noweId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, wzor);
  } finally {
    crypto.randomUUID = oryginal;
  }
});
