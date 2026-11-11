// Promocje najmu (decyzja 12 z 10.11 i prośba z 11.11): rabat % na N pierwszych okresów.
// Promocja to nie osobny mechanizm, tylko dwie stawki w historii najmu (rental_rates):
//   obniżona od pierwszego okresu promocji i normalna od pierwszego okresu po promocji.
// Lista gotowych promocji jest w settings.promotions (migracja 007); null = lista domyślna.
// Ta sama reguła końca promocji jest w supabase/jednorazowe/promocja_startowa_boxy.sql.

import { pierwszyOkresOd } from './okresy.js';
import { dodajMiesiace, parseData } from './utils.js';

export const DOMYSLNE_PROMOCJE = Object.freeze([
  Object.freeze({ id: 'startowa', nazwa: 'Promocja startowa −50% / 2 mies.', rabat: 50, okresy: 2 }),
  Object.freeze({ id: 'pierwszy-miesiac', nazwa: 'Zniżka na pierwszy miesiąc', rabat: 50, okresy: 1 }),
]);

/** Lista promocji z ustawień albo domyślna. */
export function listaPromocji(ustawienia) {
  const lista = ustawienia?.promotions;
  return Array.isArray(lista) ? lista.filter((p) => p && p.id && p.nazwa) : [...DOMYSLNE_PROMOCJE];
}

/** „−50% przez 2 mies.” */
export const opisWarunkow = (p) => `−${String(p.rabat).replace('.', ',')}% przez ${p.okresy} ${p.okresy === 1 ? 'okres' : 'okr.'}`;

/** Stawka promocyjna w groszach, zaokrąglona do pełnych złotych (decyzja „do potwierdzenia” z 0.4.2). */
export const stawkaPromocyjna = (normalnaGr, rabat) => Math.round((normalnaGr * (100 - rabat)) / 100 / 100) * 100;

/**
 * Rabat i liczba okresów z pól formularza. Zwraca { bledy, rabat, okresy }.
 * pola: nazwy pól z rabatem i liczbą okresów (różne w nowym najmie i w formularzu promocji).
 */
export function czytajWarunki(w, { rabat: poleRabatu = 'rabat', okresy: poleOkresow = 'okresy' } = {}) {
  const bledy = {};
  const rabat = Number(String(w[poleRabatu] ?? '').trim().replace(',', '.').replace(/%$/, ''));
  if (!(rabat > 0 && rabat < 100)) bledy[poleRabatu] = 'Rabat od 1 do 99%.';
  const okresy = Number(String(w[poleOkresow] ?? '').trim());
  if (!Number.isInteger(okresy) || okresy < 1 || okresy > 24) bledy[poleOkresow] = 'Od 1 do 24 okresów.';
  return { bledy, rabat, okresy };
}

/**
 * Plan promocji dla najmu: od pierwszego okresu od dnia `od` przez `okresy` okresów.
 * Koniec = pierwszy okres od tego samego dnia płatności `okresy` okresów później, np. start 05.03,
 * dzień płatności 20, 2 okresy → promocja 05.03–19.05 (niepełny okres i dwa pełne), normalnie od 20.05.
 * @returns {{ poczatek, koniec, promocyjnaGr } | null} null – najem kończy się przed `od`;
 *   koniec null – najem kończy się w trakcie promocji.
 */
export function planPromocji(najem, { normalnaGr, rabat, okresy, od = najem.start_on }) {
  if (!parseData(od)) return null;
  const poczatek = pierwszyOkresOd(najem, od < najem.start_on ? najem.start_on : od);
  if (!poczatek) return null;
  const dlugosc = najem.period_months ?? 1;
  const koniec = pierwszyOkresOd(najem, dodajMiesiace(poczatek, okresy * dlugosc, najem.billing_day));
  return { poczatek, koniec, promocyjnaGr: stawkaPromocyjna(normalnaGr, rabat) };
}

/** Wiersze rental_rates promocji: obniżona stawka i (gdy najem trwa dłużej) powrót do normalnej. */
export function wierszeStawek(najemId, plan, normalnaGr, powod) {
  const wiersze = [{ rental_id: najemId, valid_from: plan.poczatek, amount_gr: plan.promocyjnaGr, reason: powod }];
  if (plan.koniec) wiersze.push({ rental_id: najemId, valid_from: plan.koniec, amount_gr: normalnaGr, reason: 'koniec promocji' });
  return wiersze;
}

/** Nowa pozycja listy promocji (z formularza „Inna”). id unikalne w liście. */
export function nowaPozycja(lista, { nazwa, rabat, okresy }) {
  const tekst = String(nazwa ?? '').trim() || `Promocja ${opisWarunkow({ rabat, okresy })}`;
  const baza = tekst.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'promocja';
  let id = baza;
  for (let i = 2; lista.some((p) => p.id === id); i++) id = `${baza}-${i}`;
  return { id, nazwa: tekst.slice(0, 60), rabat, okresy };
}
