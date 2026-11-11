// Ręczne mapowanie kolumn wyciągu (7.2). Pliki poniżej są zmyślone, w stylu wyciągów bez gotowego profilu
// (opis nad tabelą, kolumny w innej kolejności, nadawca w opisie) – nie są kopiami prawdziwych formatów banków.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataWyciagu, kolumnyPliku, mapowaniePasuje, odczytajWyciag, odczytajZMapowaniem, zbudujMapowanie, zgadnijMapowanie,
} from '../js/banki.js';

const PLIK_A = [
  'Historia operacji;;;;;',
  'Rachunek: 11 2222 3333 4444 5555 6666 7777;;;;;',
  '',
  'Data księgowania;Data transakcji;Nazwa nadawcy;Szczegóły transakcji;Kwota operacji;Waluta operacji;Numer rachunku nadawcy',
  '2026-03-02;2026-03-01;JAN NOWAK;czynsz G-03;300,00;PLN;PL61109010140000071219812874',
  '03.03.2026;03.03.2026;Sklep;zakupy;-45,10;PLN;',
  '2026-03-04;2026-03-04;ANNA KOWALSKA;B-12 marzec;"1 150,50";PLN;61109010140000071219812875',
].join('\n');

const PLIK_B = [
  '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Opis transakcji","",""',
  '"2026-03-05","2026-03-05","Przelew na konto","+330.00","PLN","Tytuł: czynsz G-04","Nazwa nadawcy: PIOTR ZIELINSKI","Rachunek nadawcy: 61 1090 1014 0000 0712 1981 2876"',
  '"2026-03-06","2026-03-06","Płatność kartą","-20.00","PLN","Tytuł: paliwo","",""',
].join('\n');

test('daty wyciągu: różne formaty, godzina pomijana, zła data = null', () => {
  assert.equal(dataWyciagu('2026-03-01'), '2026-03-01');
  assert.equal(dataWyciagu('1.3.2026'), '2026-03-01');
  assert.equal(dataWyciagu('01/03/2026'), '2026-03-01');
  assert.equal(dataWyciagu('2026.03.01 12:30'), '2026-03-01');
  assert.equal(dataWyciagu('2026-13-01'), null);
});

test('nieznany plik: odczytajWyciag prosi o mapowanie; nagłówek znaleziony pod linijkami opisu', () => {
  assert.equal(odczytajWyciag(PLIK_A).nierozpoznany, true);
  const k = kolumnyPliku(PLIK_A);
  assert.equal(k.kolumny[0], 'Data księgowania');
  assert.equal(k.kolumny.length, 7);
  assert.equal(k.przyklady[0][2], 'JAN NOWAK');
});

test('podpowiedź mapowania po nazwach nagłówków', () => {
  const z = zgadnijMapowanie(kolumnyPliku(PLIK_A).kolumny);
  assert.deepEqual(z, { data: 'DATA KSIEGOWANIA', kwota: 'KWOTA OPERACJI', kontrahent: 'NAZWA NADAWCY',
    tytul: 'SZCZEGOLY TRANSAKCJI', rachunek: 'NUMER RACHUNKU NADAWCY', waluta: 'WALUTA OPERACJI' });
});

test('odczyt według mapowania: kwoty, wypływy, rachunek nadawcy bez „PL”', () => {
  const k = kolumnyPliku(PLIK_A);
  const o = odczytajZMapowaniem(PLIK_A, zbudujMapowanie(k.kolumny, zgadnijMapowanie(k.kolumny)));
  assert.equal(o.reczne, true);
  assert.equal(o.wiersze.length, 3);
  assert.deepEqual(o.wiersze.map((w) => w.kwotaGr), [30000, -4510, 115050]);
  assert.equal(o.wiersze[0].rachunekNadawcy, '61109010140000071219812874');
  assert.equal(o.wiersze[1].data, '2026-03-03');
  assert.ok(o.wiersze.every((w) => !w.blad));
});

test('nadawca, rachunek i tytuł z opisu „Pole: wartość”, gdy nie ma osobnych kolumn', () => {
  const k = kolumnyPliku(PLIK_B);
  const z = zgadnijMapowanie(k.kolumny);
  assert.equal(z.data, 'DATA OPERACJI');
  assert.equal(z.kwota, 'KWOTA');
  const o = odczytajZMapowaniem(PLIK_B, zbudujMapowanie(k.kolumny, { data: z.data, kwota: z.kwota, waluta: z.waluta }));
  const [w] = o.wiersze;
  assert.equal(w.kwotaGr, 33000);
  assert.equal(w.kontrahent, 'PIOTR ZIELINSKI');
  assert.equal(w.rachunekNadawcy, '61109010140000071219812876');
  assert.equal(w.tytul, 'czynsz G-04');
});

test('zapamiętane mapowanie pasuje tylko do pliku z tymi samymi nagłówkami; pusta kwota = wypływ', () => {
  const k = kolumnyPliku(PLIK_A);
  const m = zbudujMapowanie(k.kolumny, zgadnijMapowanie(k.kolumny));
  assert.equal(mapowaniePasuje(m, PLIK_A), true);
  assert.equal(mapowaniePasuje(m, PLIK_B), false);
  const uznania = 'Data;Opis;Uznania;Obciążenia\n2026-03-01;czynsz;300,00;\n2026-03-02;opłata;;12,00';
  const ku = kolumnyPliku(uznania);
  const o = odczytajZMapowaniem(uznania, zbudujMapowanie(ku.kolumny, zgadnijMapowanie(ku.kolumny)));
  assert.deepEqual(o.wiersze.map((w) => [w.kwotaGr, Boolean(w.blad)]), [[30000, false], [0, false]]);
});

// Profile PKO BP i Alior – zanonimizowane kopie plików przesłanych przez użytkowniczkę (tests/pliki/).
import { readFileSync } from 'node:fs';
import { dekoduj } from '../js/csv.js';

const plik = (nazwa) => dekoduj(readFileSync(new URL(`./pliki/${nazwa}`, import.meta.url)));

test('PKO BP: Windows-1250, wiersz w cudzysłowie, nadawca/rachunek/tytuł z opisu', () => {
  const o = odczytajWyciag(plik('pko_przyklad.csv'));
  assert.equal(o.bank, 'pko');
  assert.equal(o.wiersze.length, 2);
  const [karta, przelew] = o.wiersze;
  assert.equal(karta.kwotaGr, -20960);
  assert.deepEqual([przelew.data, przelew.kwotaGr, przelew.rachunekNadawcy], ['2026-11-10', 20000, '61109010140000071219812874']);
  assert.equal(przelew.kontrahent, 'JAN TESTOWY UL. PRZYKŁADOWA 1/2');
  assert.equal(przelew.tytul, 'opłata za na najem boxa kontenerow ego nr 12');
});

test('Alior: linia kryteriów nad tabelą, kwota w walucie rachunku, własny rachunek z wpływu', () => {
  const o = odczytajWyciag(plik('alior_przyklad.csv'));
  assert.equal(o.bank, 'alior');
  assert.equal(o.rachunek, '11222233334444555566667777');
  assert.deepEqual(o.wiersze.map((w) => w.kwotaGr), [-1849, -2598, -9770, 35000]);
  const w = o.wiersze[3];
  assert.deepEqual([w.data, w.kontrahent, w.tytul, w.rachunekNadawcy],
    ['2026-11-10', 'ANNA PRZYKŁADOWA UL. TESTOWA 5 KRAKÓW', 'czynsz G-07 listopad', '61109010140000071219812875']);
  assert.equal(kolumnyPliku(plik('alior_przyklad.csv')).kolumny[0], 'Data transakcji');   // nagłówek pod linią kryteriów
});
