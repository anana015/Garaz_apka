// Zadania: notatki klientów z terminem (client_notes.promised_on). Czyste funkcje.

import { roznicaDni } from './utils.js';

export const KTO = Object.freeze({ ja: 'Moje', klient: 'Klienta' });

export const RODZAJE_NOTATEK = Object.freeze({
  notatka: 'Notatka', telefon: 'Telefon', sms: 'SMS', email: 'E-mail', obietnica: 'Obietnica zapłaty',
});

/** Wszystkie notatki z terminem; otwarte (bez done_at) albo zrobione. */
export function zadania(notatki, { zrobione = false } = {}) {
  return notatki.filter((n) => n.promised_on && Boolean(n.done_at) === zrobione);
}

/** Grupa terminu względem dziś: zalegle | dzis | tydzien | pozniej. */
export function grupaTerminu(termin, dzis) {
  const d = roznicaDni(dzis, termin);
  if (d < 0) return 'zalegle';
  if (d === 0) return 'dzis';
  if (d <= 7) return 'tydzien';
  return 'pozniej';
}

/** Liczba otwartych zadań zaległych i na dziś – licznik zakładki i pasek na pulpicie. */
export function pilneZadania(notatki, dzis) {
  return zadania(notatki).filter((n) => n.promised_on <= dzis).length;
}

/** Akcja „Zrobione” / „Przywróć” (zakładka Zadania i karta klienta). Przycisk: data-id, data-zrobione="1"|"". */
export async function oznaczZadanie(el, ctx) {
  const zrobione = el.dataset.zrobione === '1';
  el.disabled = true;
  try {
    const n = await ctx.db.zmien('client_notes', el.dataset.id, { done_at: zrobione ? new Date().toISOString() : null });
    ctx.scal({ client_notes: [n] });
    ctx.toast(zrobione ? 'Zadanie zrobione' : 'Zadanie przywrócone');
    ctx.render();
  } catch (e) {
    el.disabled = false;
    ctx.toast(e.message);
  }
}
