// Start aplikacji, router (#/ekran/parametr), render() aktywnego ekranu i obsługa zdarzeń.
// Widoki zwracają HTML i obsługują akcje; nie importują app.js – dostają kontekst (ctx).

import { state, pusteDane, ustawDane } from './state.js';
import * as db from './db.js';
import { doPrzypisania } from './dane.js';
import { ikona, toast } from './ui.js';
import { esc } from './utils.js';

import pulpit from './views/pulpit.js';
import wplaty from './views/wplaty.js';
import klienci from './views/klienci.js';
import jednostki from './views/jednostki.js';
import raporty from './views/raporty.js';
import importWidok from './views/import.js';
import ustawienia from './views/ustawienia.js';
import logowanie from './views/logowanie.js';

const EKRANY = { pulpit, wplaty, klienci, jednostki, raporty, import: importWidok, ustawienia };
const ZAKLADKI = [
  { id: 'pulpit', tekst: 'Pulpit' },
  { id: 'wplaty', tekst: 'Wpłaty' },
  { id: 'klienci', tekst: 'Klienci' },
  { id: 'jednostki', tekst: 'Jednostki' },
  { id: 'raporty', tekst: 'Raporty' },
];

const $ = (id) => document.getElementById(id);

/** Kontekst przekazywany do akcji widoków. */
const ctx = { state, render, toast, db, odswiez: wczytajDane, nawiguj };

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

function czytajAdres() {
  const [ekran = 'pulpit', parametr = null] = location.hash.replace(/^#\/?/, '').split('/')
    .filter(Boolean).map(decodeURIComponent);
  return EKRANY[ekran] ? { ekran, parametr } : { ekran: 'pulpit', parametr: null };
}

function nawiguj(sciezka) {
  const cel = `#/${sciezka}`;
  if (location.hash === cel) render();
  else location.hash = cel;
}

function poZmianieAdresu() {
  const { ekran, parametr } = czytajAdres();
  const zmiana = ekran !== state.ui.ekran || parametr !== state.ui.parametr;
  state.ui.ekran = ekran;
  state.ui.parametr = parametr;
  render();
  if (zmiana) {
    window.scrollTo(0, 0);
    $('tytul').focus({ preventScroll: true });   // czytnik ekranu ogłasza nowy ekran
  }
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------

/** Pasek zakładek budowany raz; render() zmienia tylko aria-current i liczniki. */
function zbudujPowloke() {
  $('zakladki').innerHTML = `<div class="marka"><img src="icons/icon.svg" alt="" width="28" height="28">Najem magazynów</div>`
    + ZAKLADKI.map((z) => `
    <a href="#/${z.id}" data-zakladka="${z.id}">${ikona(z.id)}<span>${z.tekst}</span>
      <span class="licznik" hidden></span></a>`).join('');
  $('przycisk-import').innerHTML = ikona('import');
  $('przycisk-ustawienia').innerHTML = ikona('ustawienia');
}

/** Liczniki w czerwonym kółku (12.1) z opisem dla czytnika ekranu. */
function liczniki() {
  return {
    wplaty: { n: doPrzypisania(state.dane.payments).length, opis: 'do przypisania' },
    klienci: { n: 0, opis: 'dłużników' },   // liczba dłużników – krok 1c (statystyki.js)
  };
}

function renderPowloka(widok) {
  const naZakladce = ZAKLADKI.some((z) => z.id === state.ui.ekran);
  const l = liczniki();
  for (const a of $('zakladki').querySelectorAll('a')) {
    const id = a.dataset.zakladka;
    // „page” na samej zakładce, „true” na szczegółach w jej obrębie (np. karta klienta) – podświetlenie zostaje.
    if (id !== state.ui.ekran) a.removeAttribute('aria-current');
    else a.setAttribute('aria-current', state.ui.parametr ? 'true' : 'page');
    const licznik = a.querySelector('.licznik');
    const n = l[id]?.n ?? 0;
    licznik.hidden = n === 0;
    licznik.innerHTML = n ? `${n}<span class="sr-only"> ${l[id].opis}</span>` : '';
  }
  // Ekrany Import i Ustawienia oraz szczegóły mają „‹ [ekran nadrzędny]” (12.1)
  const wstecz = widok.wstecz?.(state) ?? (naZakladce ? null : { href: '#/pulpit', tekst: 'Pulpit' });
  $('wstecz').hidden = !wstecz;
  if (wstecz) {
    $('wstecz').href = wstecz.href;
    $('wstecz').innerHTML = `${ikona('wstecz', 20)}<span>${esc(wstecz.tekst)}</span>`;
  }
  const tytul = widok.tytul(state);
  $('tytul').textContent = tytul;
  document.title = `${tytul} · Najem magazynów`;
}

function banery() {
  const b = [];
  if (state.podglad) {
    b.push(`<div class="baner ostrzezenie" role="note"><span><strong>Tryb podglądu.</strong>
      Brak konfiguracji Supabase w js/config.js – dane nie są pobierane ani zapisywane.</span></div>`);
  }
  if (state.offline) {
    b.push('<div class="baner ostrzezenie" role="status">Brak internetu. Widzisz ostatnio pobrane dane; zmiany wymagają połączenia.</div>');
  }
  if (state.blad) {
    b.push(`<div class="baner blad" role="alert"><span>${esc(state.blad)}
      <button type="button" class="link-btn" data-akcja="ponow">Spróbuj ponownie</button></span></div>`);
  }
  return b.join('');
}

export function render() {
  const faza = state.faza;
  $('start').hidden = faza !== 'start';
  $('ekran-logowania').hidden = faza !== 'logowanie';
  $('app').hidden = faza !== 'aplikacja';

  if (faza === 'logowanie') {
    $('ekran-logowania').innerHTML = logowanie.render(state);
    return;
  }
  if (faza !== 'aplikacja') return;

  const widok = EKRANY[state.ui.ekran];
  const main = $('widok');

  // Zapamiętaj fokus i kursor (np. w polu wyszukiwania), bo innerHTML podmienia elementy.
  const aktywny = document.activeElement;
  const fokus = aktywny?.id && main.contains(aktywny)
    ? { id: aktywny.id, start: aktywny.selectionStart, koniec: aktywny.selectionEnd } : null;

  renderPowloka(widok);
  main.innerHTML = state.ladowanie
    ? '<div class="ladowanie" role="status">Pobieranie danych…</div>'
    : banery() + widok.render(state);

  if (fokus) {
    const el = document.getElementById(fokus.id);
    if (el) {
      el.focus({ preventScroll: true });
      if (fokus.start != null && el.setSelectionRange) el.setSelectionRange(fokus.start, fokus.koniec);
    }
  }
  widok.poRenderze?.(main, state);
}

// ---------------------------------------------------------------------
// Zdarzenia (delegacja: jeden nasłuchiwacz na dokument)
// ---------------------------------------------------------------------

function aktywnyWidok() {
  return state.faza === 'logowanie' ? logowanie : EKRANY[state.ui.ekran];
}

/** Akcje wspólne dla wszystkich widoków. */
const AKCJE_WSPOLNE = {
  filtr(el) {
    state.ui.filtry[state.ui.ekran] = el.dataset.wartosc;
    render();
  },
  miesiac(el) {
    state.ui.miesiac = el.dataset.wartosc;
    render();
  },
  /** Przejście na ekran z ustawionym filtrem, np. pasek „N wpłat czeka na przypisanie”. */
  idz(el) {
    const { ekran, filtr } = el.dataset;
    if (filtr) state.ui.filtry[ekran] = filtr;
    nawiguj(ekran);
  },
  ponow() {
    wczytajDane();
  },
};

function poKliknieciu(ev) {
  // Klik w zakładkę: zamyka szczegóły, czyści filtr i wyszukiwanie, przewija na górę (12.1)
  const zakladka = ev.target.closest('[data-zakladka]');
  if (zakladka) {
    const id = zakladka.dataset.zakladka;
    delete state.ui.filtry[id];
    delete state.ui.szukaj[id];
    if (location.hash === `#/${id}`) {
      ev.preventDefault();
      render();
      window.scrollTo(0, 0);
    }
    return;
  }
  const el = ev.target.closest('[data-akcja]');
  if (!el || el.getAttribute('aria-disabled') === 'true') return;
  const nazwa = el.dataset.akcja;
  const akcja = aktywnyWidok().akcje?.[nazwa] ?? AKCJE_WSPOLNE[nazwa];
  if (akcja) {
    ev.preventDefault();
    akcja(el, ctx, ev);
  }
}

function poWpisaniu(ev) {
  const el = ev.target;
  if (el.dataset?.pole === 'szukaj') {
    state.ui.szukaj[state.ui.ekran] = el.value;
    render();
  }
}

function poWyslaniu(ev) {
  const form = ev.target.closest('form[data-formularz]');
  const obsluga = form && aktywnyWidok().formularze?.[form.dataset.formularz];
  if (obsluga) {
    ev.preventDefault();
    obsluga(form, ctx, ev);
  }
}

// ---------------------------------------------------------------------
// Dane i sesja
// ---------------------------------------------------------------------

async function wczytajDane() {
  if (state.podglad || !state.uzytkownik) return;
  state.ladowanie = true;
  state.blad = null;
  render();
  try {
    await db.zapewnijUstawienia(state.uzytkownik.id);
    ustawDane(await db.pobierzWszystko());
  } catch (e) {
    state.blad = e.message;
  } finally {
    state.ladowanie = false;
    render();
  }
}

async function poZmianieSesji(sesja) {
  const user = sesja?.user ?? null;
  if (user?.id === state.uzytkownik?.id && state.faza !== 'start') return;   // np. odświeżenie tokenu
  if (!user) {
    if (state.faza === 'logowanie') return;   // nie kasuj wpisywanego formularza
    state.uzytkownik = null;
    ustawDane(pusteDane());
    state.faza = 'logowanie';
    render();
    return;
  }
  state.uzytkownik = { id: user.id, email: user.email };
  state.faza = 'aplikacja';
  await wczytajDane();
}

function rejestrujServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
}

async function start() {
  zbudujPowloke();
  document.addEventListener('click', poKliknieciu);
  document.addEventListener('input', poWpisaniu);
  document.addEventListener('submit', poWyslaniu);
  window.addEventListener('hashchange', poZmianieAdresu);
  window.addEventListener('online', () => { state.offline = false; render(); });
  window.addEventListener('offline', () => { state.offline = true; render(); });

  const { ekran, parametr } = czytajAdres();
  Object.assign(state.ui, { ekran, parametr });
  rejestrujServiceWorker();

  if (!db.skonfigurowano()) {
    state.podglad = true;
    state.faza = 'aplikacja';
    render();
    return;
  }
  try {
    await poZmianieSesji(await db.pobierzSesje());
    await db.nasluchujSesji(poZmianieSesji);
  } catch (e) {
    state.faza = 'logowanie';
    state.blad = e.message;
    render();
  }
}

start();
