// Formularze (8.6): stan w state.ui.form, odczyt pól, elementy z etykietą i błędem pod polem (12.5).
// Funkcje rysujące zwracają HTML; dane użytkownika przechodzą przez esc().
//
// Przebieg zapisu w widoku:
//   const w = wartosciFormularza(form);
//   const { bledy, wiersz } = walidujX(w, …);          // js/walidacja.js
//   if (maBledy(ctx, w, bledy)) return;                 // pokazuje błędy, fokus na pierwszym polu
//   await zapisz(ctx, async () => { …db…; ctx.scal(…); ctx.nawiguj(…); });

import { esc, formatZl } from './utils.js';

/**
 * Stan formularza dla klucza (np. 'jednostki/nowa'). Nowy klucz = świeży stan z wartości początkowych.
 * app.js czyści state.ui.form przy każdej zmianie adresu, więc powrót do formularza zaczyna od nowa.
 */
export function stanFormularza(s, klucz, poczatkowe) {
  if (s.ui.form?.klucz !== klucz) {
    s.ui.form = { klucz, wartosci: poczatkowe(), bledy: {}, blad: null, trwa: false, pliki: {}, podglad: null };
  }
  return s.ui.form;
}

/** Wartości pól jako tekst. Pole występujące kilka razy (lista pól wyboru) → tablica. Pliki pomijane. */
export function wartosciFormularza(form) {
  const w = {};
  for (const [k, v] of new FormData(form)) {
    if (typeof v !== 'string') continue;   // pliki są w state.ui.form.pliki (input file czyści się przy przerysowaniu)
    w[k] = k in w ? [].concat(w[k], v) : v;
  }
  return w;
}

/** Zapisuje wartości i błędy w stanie. Gdy są błędy: przerysowuje i ustawia fokus na pierwszym błędnym polu. */
export function maBledy(ctx, w, bledy) {
  const f = ctx.state.ui.form;
  Object.assign(f, { wartosci: w, bledy, blad: null });
  if (!Object.keys(bledy).length) return false;
  ctx.render();
  document.querySelector('#widok [aria-invalid="true"]')?.focus();
  return true;
}

/**
 * Zapis z blokadą przycisku i komunikatem błędu serwera nad przyciskiem.
 * `dzialanie` po sukcesie przechodzi dalej (ctx.nawiguj) albo sama przerysowuje ekran.
 */
export async function zapisz(ctx, dzialanie) {
  const f = ctx.state.ui.form;
  if (!f || f.trwa) return;
  if (ctx.state.podglad) {
    f.blad = 'Tryb podglądu: brak konfiguracji Supabase, zapis jest niemożliwy.';
    ctx.render();
    return;
  }
  if (ctx.state.offline || ctx.state.zKopii) {
    f.blad = 'Brak połączenia z serwerem. Zapis wymaga połączenia.';
    ctx.render();
    return;
  }
  Object.assign(f, { trwa: true, blad: null });
  ctx.render();
  try {
    await dzialanie();
  } catch (e) {
    f.blad = e.message;
    f.trwa = false;
    if (ctx.state.ui.form === f) {
      ctx.render();
      document.getElementById('f-blad-zapisu')?.focus();
    }
  }
}

// ---------------------------------------------------------------------
// Elementy
// ---------------------------------------------------------------------

const idPola = (nazwa) => `f-${nazwa}`;
const ZNAK_WYMAGANE = '<span class="wymagane" aria-hidden="true"> *</span>';

/** aria-describedby (podpowiedź + błąd), aria-invalid i teksty pod polem. */
function opis(nazwa, podpowiedz, blad) {
  const id = idPola(nazwa);
  const opisy = [podpowiedz && `${id}-opis`, blad && `${id}-blad`].filter(Boolean);
  return {
    aria: `${opisy.length ? ` aria-describedby="${opisy.join(' ')}"` : ''}${blad ? ' aria-invalid="true"' : ''}`,
    pod: `${podpowiedz ? `<p id="${id}-opis" class="podpowiedz">${esc(podpowiedz)}</p>` : ''}${
      blad ? `<p id="${id}-blad" class="blad">${esc(blad)}</p>` : ''}`,
  };
}

function etykieta(nazwa, tekst, wymagane) {
  return `<label for="${idPola(nazwa)}">${esc(tekst)}${wymagane ? ZNAK_WYMAGANE : ''}</label>`;
}

const atrybutWymagane = (wymagane) => (wymagane ? ' aria-required="true"' : '');
const atrybutOdswiez = (odswiez) => (odswiez ? ' data-odswiez' : '');

/**
 * Pole tekstowe, daty, liczby albo kwoty.
 * typ 'kwota' = tekst z klawiaturą numeryczną (kwoty wpisuje się z przecinkiem, np. 300,50).
 */
export function pole(f, { nazwa, etykieta: tekst, typ = 'text', podpowiedz, wymagane = false, odswiez = false,
  atrybuty = '', klasa = '' }) {
  const wartosc = f.wartosci[nazwa] ?? '';
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  const typHtml = typ === 'kwota' ? 'text' : typ;
  const dodatkowe = typ === 'kwota' ? ' inputmode="decimal" autocomplete="off"' : '';
  return `<div class="pole${klasa ? ` ${klasa}` : ''}">${etykieta(nazwa, tekst, wymagane)}
    <input id="${idPola(nazwa)}" name="${nazwa}" type="${typHtml}" value="${esc(wartosc)}"${dodatkowe}${
  atrybutWymagane(wymagane)}${atrybutOdswiez(odswiez)}${o.aria} ${atrybuty}>${o.pod}</div>`;
}

export function obszar(f, { nazwa, etykieta: tekst, podpowiedz, wymagane = false, wiersze = 3, maks }) {
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  return `<div class="pole">${etykieta(nazwa, tekst, wymagane)}
    <textarea id="${idPola(nazwa)}" name="${nazwa}" rows="${wiersze}"${maks ? ` maxlength="${maks}"` : ''}${
  atrybutWymagane(wymagane)}${o.aria}>${esc(f.wartosci[nazwa] ?? '')}</textarea>${o.pod}</div>`;
}

/**
 * Lista wyboru. opcje: [{ wartosc, tekst, grupa? }] – kolejne opcje z tą samą grupą trafiają do <optgroup>.
 * pusta: tekst pierwszej, pustej opcji (np. „Wybierz…”).
 */
export function wybor(f, { nazwa, etykieta: tekst, opcje, podpowiedz, wymagane = false, odswiez = false, pusta }) {
  const wartosc = String(f.wartosci[nazwa] ?? '');
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  let html = pusta != null ? `<option value="">${esc(pusta)}</option>` : '';
  let grupa = null;
  for (const op of opcje) {
    if (op.grupa !== grupa) {
      if (grupa != null) html += '</optgroup>';
      if (op.grupa != null) html += `<optgroup label="${esc(op.grupa)}">`;
      grupa = op.grupa ?? null;
    }
    html += `<option value="${esc(op.wartosc)}"${String(op.wartosc) === wartosc ? ' selected' : ''}>${esc(op.tekst)}</option>`;
  }
  if (grupa != null) html += '</optgroup>';
  return `<div class="pole">${etykieta(nazwa, tekst, wymagane)}
    <select id="${idPola(nazwa)}" name="${nazwa}"${atrybutWymagane(wymagane)}${atrybutOdswiez(odswiez)}${o.aria}>${html}</select>${o.pod}</div>`;
}

/** Pole wyboru (checkbox) z etykietą obok. */
export function przelacznik(f, { nazwa, etykieta: tekst, podpowiedz, odswiez = false }) {
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  const zaznaczony = ['on', true, 'true'].includes(f.wartosci[nazwa]);
  return `<div class="pole pole-wyboru">
    <input id="${idPola(nazwa)}" name="${nazwa}" type="checkbox"${zaznaczony ? ' checked' : ''}${atrybutOdswiez(odswiez)}${o.aria}>
    <label for="${idPola(nazwa)}">${esc(tekst)}</label>${o.pod}</div>`;
}

/** Grupa przycisków radiowych w <fieldset> z <legend>. opcje: [{ wartosc, tekst }] */
export function opcje(f, { nazwa, legenda, opcje: lista, podpowiedz, odswiez = false }) {
  const wartosc = String(f.wartosci[nazwa] ?? '');
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  return `<fieldset class="pole opcje"${o.aria}><legend>${esc(legenda)}</legend>
    <div class="opcje-lista">${lista.map((op, i) => `<label class="opcja">
      <input type="radio" name="${nazwa}" value="${esc(op.wartosc)}"${String(op.wartosc) === wartosc ? ' checked' : ''}
        id="${idPola(nazwa)}${i ? `-${i}` : ''}"${atrybutOdswiez(odswiez)}> ${esc(op.tekst)}</label>`).join('')}</div>${o.pod}</fieldset>`;
}

/**
 * Pole pliku. Wybrany plik zostaje w state.ui.form.pliki (app.js zapamiętuje go przy zdarzeniu change),
 * bo przerysowanie ekranu czyści <input type="file">.
 */
export function plik(f, { nazwa, etykieta: tekst, akceptuj, podpowiedz }) {
  const wybrany = f.pliki?.[nazwa];
  const o = opis(nazwa, podpowiedz, f.bledy[nazwa]);
  const info = wybrany
    ? `<p class="wybrany-plik">Wybrano: <strong>${esc(wybrany.name)}</strong> (${rozmiarPliku(wybrany.size)})
        <button type="button" class="link-btn" data-akcja="usun-plik" data-pole="${nazwa}">Usuń</button></p>` : '';
  return `<div class="pole">${etykieta(nazwa, tekst, false)}
    <input id="${idPola(nazwa)}" name="${nazwa}" type="file"${akceptuj ? ` accept="${esc(akceptuj)}"` : ''}${o.aria}>
    ${info}${o.pod}</div>`;
}

/** 1 234 567 B → "1,2 MB" */
export function rozmiarPliku(bajty) {
  if (bajty < 1024) return `${bajty} B`;
  if (bajty < 1024 * 1024) return `${Math.round(bajty / 1024)} kB`;
  return `${(bajty / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Cały formularz: komunikat błędu zapisu, treść i przyciski.
 * @param {object} f stan formularza
 * @param {{ nazwa: string, tresc: string, przycisk: string, anuluj?: string, drugiPrzycisk?: {tekst, wartosc},
 *   uwaga?: string }} o
 */
export function formularz(f, { nazwa, tresc, przycisk, anuluj, drugiPrzycisk, uwaga = 'Pola z * są wymagane.' }) {
  return `<form class="karta formularz" data-formularz="${nazwa}" novalidate>
    ${uwaga ? `<p class="podpowiedz">${esc(uwaga)}</p>` : ''}
    ${tresc}
    ${f.blad ? `<p id="f-blad-zapisu" class="blad-tekst" role="alert" tabindex="-1">${esc(f.blad)}</p>` : ''}
    <div class="pasek-akcji pasek-formularza">
      <button class="przycisk" type="submit" name="tryb_wysylki" value="zapisz"${f.trwa ? ' disabled' : ''}>${
  f.trwa ? 'Zapisywanie…' : esc(przycisk)}</button>
      ${drugiPrzycisk ? `<button class="przycisk drugi" type="submit" name="tryb_wysylki" value="${esc(drugiPrzycisk.wartosc)}"${
    f.trwa ? ' disabled' : ''}>${esc(drugiPrzycisk.tekst)}</button>` : ''}
      ${anuluj ? `<a class="link-anuluj" href="${esc(anuluj)}">Anuluj</a>` : ''}
    </div>
  </form>`;
}

/** Sekcja formularza z nagłówkiem (fieldset bez ramki). */
export function sekcja(tytul, tresc) {
  return `<fieldset class="sekcja-formularza"><legend>${esc(tytul)}</legend>${tresc}</fieldset>`;
}

/** Kwota do podglądu w formularzu. */
export const kwotaPodgladu = (gr) => `<span class="kwota">${formatZl(gr)}</span>`;
