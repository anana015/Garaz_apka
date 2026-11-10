import { test } from 'node:test';
import assert from 'node:assert/strict';
import { komunikatZapisu } from '../js/db.js';

test('komunikatZapisu: ograniczenia bazy po polsku', () => {
  assert.equal(komunikatZapisu({ code: '23505', message: 'duplicate key value violates unique constraint "units_user_id_code_key"' }),
    'Jednostka o tym numerze już istnieje.');
  assert.match(komunikatZapisu({ code: '23P01', message: 'conflicting key value violates exclusion constraint "rentals_no_overlap"' }),
    /ma już najem/);
  assert.match(komunikatZapisu({ code: '23503', message: 'update or delete on table "clients" violates foreign key constraint' }),
    /archiwizacji/);
  assert.match(komunikatZapisu({ code: '23514', message: 'new row violates check constraint "clients_nip_check"' }), /clients_nip_check/);
  assert.match(komunikatZapisu({ code: 'PGRST202', message: 'Could not find the function public.zapisz_pakiet(p)' }),
    /001_zapisz_pakiet\.sql/);
  assert.match(komunikatZapisu({ message: 'TypeError: Failed to fetch' }), /Brak połączenia/);
  assert.match(komunikatZapisu({ message: 'coś innego' }), /Nie udało się zapisać: coś innego/);
});
