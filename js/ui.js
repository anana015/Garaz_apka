// Wspólne elementy interfejsu: ikony, komunikat (toast), puste stany, filtry.
// Funkcje zwracają tekst HTML; dane użytkownika zawsze przechodzą przez esc().

import { TOAST_MS } from './config.js';
import { esc } from './utils.js';

// Ikony liniowe 24×24, rysowane kolorem tekstu (currentColor).
const SCIEZKI = {
  pulpit: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  wplaty: '<path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  klienci: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.5 3.3-5.5 6.5-5.5s5.8 2 6.5 5.5"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.9c1.8.8 3 2.4 3.5 5.1"/>',
  jednostki: '<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-8h10v8"/><path d="M7 15h10"/><path d="M7 17.5h10"/>',
  zadania: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3v2.5"/><path d="M15 3v2.5"/><path d="m8.5 13 2.3 2.3 4.7-4.6"/>',
  raporty: '<path d="M4 20V11"/><path d="M10 20V5"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
  import: '<path d="M14 3H6.5a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="m9 14.5 3-3 3 3"/>',
  ustawienia: '<path d="M4 6h9"/><path d="M19 6h1"/><circle cx="16" cy="6" r="2.2"/><path d="M4 12h3"/><path d="M13 12h7"/><circle cx="10" cy="12" r="2.2"/><path d="M4 18h11"/><circle cx="18" cy="18" r="2.2"/>',
  wstecz: '<path d="m15 18-6-6 6-6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  wyloguj: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="m10 16 4-4-4-4"/><path d="M14 12H4"/>',
};

/** Ikona SVG; dekoracyjna (aria-hidden), bo obok zawsze jest tekst albo aria-label. */
export function ikona(nazwa, rozmiar = 24) {
  return `<svg width="${rozmiar}" height="${rozmiar}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SCIEZKI[nazwa] ?? ''}</svg>`;
}

// ---------------------------------------------------------------------
// Komunikat nad paskiem zakładek (12.2): znika po 2,6 s, czytany przez czytnik ekranu.
// ---------------------------------------------------------------------
let zegarToastu = null;

export function toast(tekst) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = tekst;
  el.classList.add('widoczny');
  clearTimeout(zegarToastu);
  zegarToastu = setTimeout(() => el.classList.remove('widoczny'), TOAST_MS);
}

// ---------------------------------------------------------------------
// Bloki widoków
// ---------------------------------------------------------------------

/**
 * Pusty stan (12.3).
 * @param {string} tekst
 * @param {Array<{tekst:string, href?:string, akcja?:string, drugi?:boolean}>} przyciski
 */
export function pustyStan(tekst, przyciski = []) {
  return `<div class="pusty"><p>${esc(tekst)}</p>${przyciski.length ? `<div class="pasek-akcji">${
    przyciski.map(przycisk).join('')}</div>` : ''}</div>`;
}

/** Przycisk albo link wyglądający jak przycisk. */
export function przycisk({ tekst, href, akcja, drugi = false, ikona: ik }) {
  const klasa = `przycisk${drugi ? ' drugi' : ''}`;
  const tresc = `${ik ? ikona(ik, 20) : ''}${esc(tekst)}`;
  return href
    ? `<a class="${klasa}" href="${esc(href)}">${tresc}</a>`
    : `<button type="button" class="${klasa}" data-akcja="${esc(akcja)}">${tresc}</button>`;
}

/**
 * Pasek filtrów (przyciski przełączające, aria-pressed).
 * @param {Array<{id:string, tekst:string, liczba?:number}>} opcje
 */
export function filtry(opcje, aktywny, etykieta = 'Filtr') {
  return `<div class="filtry" role="group" aria-label="${esc(etykieta)}">${opcje.map((o) => `
    <button type="button" data-akcja="filtr" data-wartosc="${esc(o.id)}" aria-pressed="${o.id === aktywny}">
      ${esc(o.tekst)}${o.liczba != null ? ` (${o.liczba})` : ''}</button>`).join('')}</div>`;
}

/** Pole wyszukiwania; id pozwala app.js przywrócić fokus po przerysowaniu. */
export function poleSzukaj(ekran, wartosc, podpowiedz) {
  return `<label class="sr-only" for="szukaj-${ekran}">Szukaj</label>
    <input class="szukaj" id="szukaj-${ekran}" type="search" data-pole="szukaj" autocomplete="off"
      placeholder="${esc(podpowiedz)}" value="${esc(wartosc ?? '')}">`;
}

/** Ramka z informacją, w którym kroku planu (rozdz. 15) pojawi się dana część. */
export function wPlanie(tekst) {
  return `<p class="plan">${esc(tekst)}</p>`;
}

/** Pobranie pliku tekstowego (CSV) bez serwera: link z adresem blob i kliknięcie. */
export function pobierzPlik(nazwa, tresc, typ = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([tresc], { type: typ }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nazwa });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Przełącznik trybu edycji („Edytuj” ↔ „Gotowe”). Rzadziej używane opcje ekranu rysują się tylko,
 * gdy state.ui.edycja = true; app.js zeruje tryb przy zmianie adresu.
 */
export function przyciskEdycji(s) {
  return `<button type="button" class="przycisk drugi" data-akcja="tryb-edycji" aria-pressed="${Boolean(s.ui.edycja)}">${
    s.ui.edycja ? 'Gotowe' : 'Edytuj'}</button>`;
}

/** Ramka z opcjami trybu edycji. */
export function opcjeEdycji(tresc) {
  return `<div class="opcje-edycji" role="group" aria-label="Opcje edycji">${tresc}</div>`;
}
