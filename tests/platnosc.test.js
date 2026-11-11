import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opisPlatnosci } from '../js/dane.js';
import { walidujMiejscePlatnosci } from '../js/walidacja.js';

const konta = new Map([['b1', { id: 'b1', name: 'Nest – najem', bank: 'nest' }]]);

test('opis miejsca płatności: konto, nieustalone konto, gotówka, FV; stary najem bez kolumny = przelew', () => {
  assert.equal(opisPlatnosci({ pay_method: 'przelew', bank_account_id: 'b1' }, konta), 'przelew · Nest – najem');
  assert.equal(opisPlatnosci({ pay_method: 'przelew', bank_account_id: null }, konta), 'przelew · konto nieustalone');
  assert.equal(opisPlatnosci({ pay_method: 'gotowka' }, konta), 'gotówka');
  assert.equal(opisPlatnosci({ pay_method: 'fv' }, konta), 'FV');
  assert.equal(opisPlatnosci({}, konta), 'przelew · konto nieustalone');
});

test('walidacja miejsca płatności: gotówka i FV bez konta, nieznane konto to błąd, zły sposób = przelew', () => {
  assert.deepEqual(walidujMiejscePlatnosci({ pay_method: 'przelew', bank_account_id: 'b1' }, { konta }).wiersz,
    { pay_method: 'przelew', bank_account_id: 'b1' });
  assert.deepEqual(walidujMiejscePlatnosci({ pay_method: 'gotowka', bank_account_id: 'b1' }, { konta }).wiersz,
    { pay_method: 'gotowka', bank_account_id: null });
  assert.deepEqual(walidujMiejscePlatnosci({ pay_method: 'przelew', bank_account_id: '' }, { konta }).wiersz,
    { pay_method: 'przelew', bank_account_id: null });
  assert.ok(walidujMiejscePlatnosci({ pay_method: 'przelew', bank_account_id: 'xx' }, { konta }).bledy.bank_account_id);
  assert.equal(walidujMiejscePlatnosci({ pay_method: 'bitcoin' }, { konta }).wiersz.pay_method, 'przelew');
});
