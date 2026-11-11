// Start aplikacji, router (#/ekran/parametr), render() aktywnego ekranu i obsługa zdarzeń.
// Widoki zwracają HTML i obsługują akcje; nie importują app.js – dostają kontekst (ctx).

import { state, pusteDane, ustawDane } from './state.js';
import * as db from './db.js';
import { doPrzypisania, scalDane } from './dane.js';
import { wartosciFormularza } from './formularz.js';
import { ikona, toast } from './ui.js';
import { dzisiaj, esc } from './utils.js';

import pulpit from './views/pulpit.js';
import wplaty from './views/wplaty.js';
import klienci from './views/klienci.js';
import jednostki from './views/jednostki.js';
import raporty from './views/raporty.js';
import zadaniaWidok from './views/zadania.js';
import { oznaczZadanie, pilneZadania } from './zadania.js';
import importWidok from './views/import.js';
import ustawienia from './views/ustawienia.js';
import najmy from './views/najmy.js';
import koszty from './views/koszty.js';
import logowanie from './views/logowanie.js';

// najmy: formularze najmu (nowy, stawka, koniec, korekta, podwyżka) – bez własnej zakładki.
const EKRANY = { pulpit, wplaty, klienci, zadania: zadaniaWidok, jednostki, raporty, import: importWidok, ustawienia, najmy, koszty };
const ZAKLADKI = [
  { id: 'pulpit', tekst: 'Pulpit' },
  { id: 'wplaty', tekst: 'Wpłaty' },
  { id: 'klienci', tekst: 'Klienci' },
  { id: 'zadania', tekst: 'Zadania' },
  { id: 'jednostki', tekst: 'Jednostki' },
  { id: 'raporty', tekst: 'Raporty' },
];

const $ = (id) => document.getElementById(id);

/** Dopisuje zapisane wiersze do stanu i przelicza indeksy (bez pobierania wszystkiego od nowa). */
function scal(zmiany) {
  ustawDane(scalDane(state.dane, zmiany));
  if (state.uzytkownik && !state.podglad) db.zapiszLokalnie(state.uzytkownik, state.dane);
}

/** Kontekst przekazywany do akcji widoków. */
const ctx = { state, render, toast, db, odswiez: wczytajDane, nawiguj, scal };

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

/** #/ekran/parametr/akcja?klucz=wartosc → { ekran, parametr, akcja, zapytanie }. */
function czytajAdres() {
  const [sciezka, zapytanie = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [ekran = 'pulpit', parametr = null, akcja = null] = sciezka.split('/')
    .filter(Boolean).map(decodeURIComponent);
  if (!EKRANY[ekran]) return { ekran: 'pulpit', parametr: null, akcja: null, zapytanie: {} };
  return { ekran, parametr, akcja, zapytanie: Object.fromEntries(new URLSearchParams(zapytanie)) };
}

function nawiguj(sciezka) {
  const cel = `#/${sciezka}`;
  if (location.hash === cel) {
    state.ui.form = null;   // ten sam adres nie wywoła hashchange – formularz zaczyna od nowa ręcznie
    render();
  } else location.hash = cel;
}

function poZmianieAdresu() {
  const zmiana = location.hash !== state.ui.adres;
  Object.assign(state.ui, czytajAdres(), { adres: location.hash });
  if (zmiana) {
    state.ui.form = null;      // formularz zaczyna od nowa po każdym wejściu
    state.ui.edycja = false;   // tryb edycji dotyczy jednego ekranu
  }
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
    zadania: { n: pilneZadania(state.dane.client_notes, dzisiaj()), opis: 'zadań na dziś i po terminie' },
  };
}

function renderPowloka(widok) {
  const naZakladce = ZAKLADKI.some((z) => z.id === state.ui.ekran);
  // Ekran bez własnej zakładki wskazuje nadrzędną, np. formularz najmu otwarty z karty klienta → „Klienci”.
  const zakladka = (typeof widok.zakladka === 'function' ? widok.zakladka(state) : widok.zakladka) ?? state.ui.ekran;
  const l = liczniki();
  for (const a of $('zakladki').querySelectorAll('a')) {
    const id = a.dataset.zakladka;
    // „page” na samej zakładce, „true” na szczegółach w jej obrębie (np. karta klienta) – podświetlenie zostaje.
    if (id !== zakladka) a.removeAttribute('aria-current');
    else a.setAttribute('aria-current', state.ui.parametr || id !== state.ui.ekran ? 'true' : 'page');
    const licznik = a.querySelector('.licznik');
    const n = l[id]?.n ?? 0;
    licznik.hidden = n === 0;
    licznik.innerHTML = n ? `${n}<span class="sr-only"> ${l[id].opis}</span>` : '';
  }
  // Ekrany Import i Ustawienia oraz szczegóły mają „‹ [ekran nadrzędny]” (12.1)
  const wstecz = widok.wstecz?.(state) ?? (naZakladce || widok.zakladka ? null : { href: '#/pulpit', tekst: 'Pulpit' });
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
  if (state.zKopii) {
    b.push(`<div class="baner ostrzezenie" role="status"><span>${state.offline ? 'Brak internetu.' : 'Brak połączenia z serwerem.'}
      Widzisz dane zapisane na tym urządzeniu ${esc(znacznikCzasu(state.zKopii))} – tylko do odczytu.
      <button type="button" class="link-btn" data-akcja="ponow">Spróbuj ponownie</button></span></div>`);
  } else if (state.offline) {
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
  'zadanie-zrobione': (el) => oznaczZadanie(el, ctx),
  /** „Edytuj” / „Gotowe”: pokazuje albo chowa rzadziej używane opcje ekranu. */
  'tryb-edycji'() {
    state.ui.edycja = !state.ui.edycja;
    render();
    document.querySelector('#widok [data-akcja="tryb-edycji"]')?.focus();
  },
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
  /** „Usuń” przy wybranym pliku w formularzu (formularz.plik). */
  'usun-plik'(el) {
    const f = state.ui.form;
    const form = el.closest('form');
    if (!f || !form) return;
    f.wartosci = wartosciFormularza(form);
    delete f.pliki[el.dataset.pole];
    delete f.bledy[el.dataset.pole];
    render();
    document.getElementById(`f-${el.dataset.pole}`)?.focus();
  },
};

function poKliknieciu(ev) {
  // Klik w zakładkę: zamyka szczegóły, czyści filtr i wyszukiwanie, przewija na górę (12.1)
  const zakladka = ev.target.closest('[data-zakladka]');
  if (zakladka) {
    const id = zakladka.dataset.zakladka;
    delete state.ui.filtry[id];
    delete state.ui.szukaj[id];
    state.ui.edycja = false;
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

/**
 * Zmiana pola:
 *  - data-zmiana="akcja" → widok.zmiany[akcja] (np. wybór pliku z danymi startowymi);
 *  - <input type="file"> w formularzu → plik zapamiętany w state.ui.form.pliki (przerysowanie czyści pole);
 *  - pole z data-odswiez → wartości zapamiętane, widok.przyZmianie[formularz] może podpowiedzieć inne pola,
 *    ekran przerysowany (np. stawka z cennika po wyborze jednostki).
 */
function poZmianie(ev) {
  const el = ev.target;
  const widok = aktywnyWidok();
  if (el.dataset?.zmiana) {
    widok.zmiany?.[el.dataset.zmiana]?.(el, ctx, ev);
    return;
  }
  const form = el.closest?.('form[data-formularz]');
  const f = state.ui.form;
  if (!form || !f) return;
  if (el.type === 'file') {
    f.wartosci = wartosciFormularza(form);
    f.pliki[el.name] = el.files?.[0] ?? null;
    if (!f.pliki[el.name]) delete f.pliki[el.name];
    widok.przyZmianie?.[form.dataset.formularz]?.(el.name, f, state);
    render();
    return;
  }
  if (el.dataset?.odswiez === undefined) return;
  const poprzednie = f.wartosci;
  f.wartosci = wartosciFormularza(form);
  widok.przyZmianie?.[form.dataset.formularz]?.(el.name, f, state, poprzednie);
  render();
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

/** „11.11.2026, 08:15” – kiedy zapisano kopię lokalną. */
function znacznikCzasu(iso) {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

/** Dane z kopii na urządzeniu (tryb offline, tylko odczyt). Zwraca true, gdy kopia należy do tego użytkownika. */
async function zKopiiLokalnej(userId = null) {
  const k = await db.wczytajLokalnie();
  if (!k?.dane || (userId && k.userId !== userId)) return false;
  ustawDane(k.dane);
  state.zKopii = k.zapisano;
  if (!state.uzytkownik) state.uzytkownik = { id: k.userId, email: k.email };
  return true;
}

async function wczytajDane() {
  if (state.podglad || !state.uzytkownik) return;
  state.ladowanie = true;
  state.blad = null;
  render();
  try {
    await db.zapewnijUstawienia(state.uzytkownik.id);
    ustawDane(await db.pobierzWszystko());
    state.zKopii = null;
    db.zapiszLokalnie(state.uzytkownik, state.dane);
  } catch (e) {
    // Brak połączenia: ostatnio pobrane dane z urządzenia. Inne błędy (np. sesja) – komunikat.
    const siec = state.offline || /fetch|network|połączenia/i.test(e.message);
    if (!siec || !await zKopiiLokalnej(state.uzytkownik.id)) state.blad = e.message;
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
    db.wyczyscLokalnie();                      // wylogowanie: dane klientów nie zostają na urządzeniu
    state.uzytkownik = null;
    state.zKopii = null;
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
  document.addEventListener('change', poZmianie);
  document.addEventListener('submit', poWyslaniu);
  window.addEventListener('hashchange', poZmianieAdresu);
  window.addEventListener('online', () => {
    state.offline = false;
    if (state.zKopii) wczytajDane();   // wróciło połączenie – pobierz aktualne dane
    else render();
  });
  window.addEventListener('offline', () => { state.offline = true; render(); });

  Object.assign(state.ui, czytajAdres(), { adres: location.hash });
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
    // Start bez internetu (np. nie da się odświeżyć sesji): pokaż dane z urządzenia, jeśli są.
    if (await zKopiiLokalnej()) {
      state.faza = 'aplikacja';
      render();
      return;
    }
    state.faza = 'logowanie';
    state.blad = e.message;
    render();
  }
}

start();
