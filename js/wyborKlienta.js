// Wybór klienta z wyszukiwarką (0.27.0, prośba 20.11.2026) – zamiast długiej listy <select>.
// Na iPhonie przewijanie kółka <select> od razu zmieniało wybór; tutaj klient zapisuje się WYŁĄCZNIE po dotknięciu
// (kliknięciu) pozycji albo Enter na podświetlonej pozycji. Samo wpisanie tekstu, przewijanie czy najechanie niczego
// nie wybiera – bez wyboru zostaje pusto („do przypisania”).
//
// HTML: pole tekstowe (combobox) + ukryte pole z id klienta (name = nazwa pola formularza) + lista podpowiedzi.
// Zachowanie: jeden zestaw nasłuchiwaczy na dokumencie (instaluj()); listy klientów w rejestrze (zarejestruj()).

import { esc } from './utils.js';
import { pasuje, przygotujZapytanie } from './szukaj.js';

const MAKS_PODPOWIEDZI = 8;
const DO_PRZYPISANIA = 'Nie wybrano – wpłata trafi do „Do przypisania”.';
const rejestr = new Map();   // klucz listy → [{ id, tekst }]

/** Lista klientów do podpowiedzi (np. „import”); ta sama dla wszystkich pól danego ekranu. */
export function zarejestruj(klucz, klienci) {
  rejestr.set(klucz, klienci);
}

/** Klienci pasujący do tekstu (każde słowo, bez ogonków; „g03” znajduje „G-03”). Czysta funkcja. */
export function podpowiedzi(klienci, tekst, maks = MAKS_PODPOWIEDZI) {
  const z = przygotujZapytanie(tekst);
  if (!z.slowa.length) return klienci.slice(0, maks);
  return klienci.filter((k) => pasuje(z, k.tekst)).slice(0, maks);
}

/**
 * Pole wyboru klienta.
 * @param {{ id: string, nazwa: string, lista: string, klienci: Array<{id, tekst}>, wybrany?: string|null,
 *   etykieta?: string, odswiez?: boolean, wymagane?: boolean, blad?: string }} o
 *   odswiez – wybór przerysowuje formularz (data-odswiez na ukrytym polu, jak w zwykłych polach)
 */
export function poleKlienta({ id, nazwa, lista, klienci, wybrany = null, etykieta = 'Klient', odswiez = false, wymagane = false, blad = null,
  pusto = DO_PRZYPISANIA }) {
  const k = wybrany ? klienci.find((x) => x.id === wybrany) : null;
  return `<div class="pole wybor-klienta" data-wk="${esc(lista)}" data-pusto="${esc(pusto)}">
    <label for="${esc(id)}">${esc(etykieta)}${wymagane ? ' <span aria-hidden="true">*</span>' : ''}</label>
    <div class="wk-ramka">
      <input type="text" id="${esc(id)}" class="wk-pole" value="${esc(k?.tekst ?? '')}" autocomplete="off" autocapitalize="off"
        spellcheck="false" enterkeyhint="done" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="${esc(id)}-lista" placeholder="Wpisz nazwisko, firmę albo jednostkę…"${blad ? ' aria-invalid="true"' : ''}>
      <button type="button" class="wk-wyczysc" aria-label="Wyczyść wybór klienta"${k ? '' : ' hidden'}>×</button>
      <ul id="${esc(id)}-lista" class="wk-lista" role="listbox" aria-label="Pasujący klienci" hidden></ul>
    </div>
    <input type="hidden" name="${esc(nazwa)}" value="${esc(k?.id ?? '')}"${odswiez ? ' data-odswiez' : ''}>
    <p class="wk-stan maly" aria-live="polite">${k ? '' : esc(pusto)}</p>
    ${blad ? `<p class="blad-tekst">${esc(blad)}</p>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------
// Zachowanie w przeglądarce
// ---------------------------------------------------------------------

const elementy = (pole) => {
  const kontener = pole.closest('.wybor-klienta');
  return {
    kontener,
    lista: kontener.querySelector('.wk-lista'),
    ukryte: kontener.querySelector('input[type="hidden"]'),
    wyczysc: kontener.querySelector('.wk-wyczysc'),
    stan: kontener.querySelector('.wk-stan'),
  };
};

function pokaz(pole) {
  const { kontener, lista } = elementy(pole);
  const klienci = rejestr.get(kontener.dataset.wk) ?? [];
  const wyniki = podpowiedzi(klienci, pole.value);
  lista.innerHTML = wyniki.length
    ? wyniki.map((k, i) => `<li role="option" id="${pole.id}-o${i}" data-id="${esc(k.id)}" aria-selected="false">${esc(k.tekst)}</li>`).join('')
    : '<li class="wk-brak" role="presentation">Brak pasujących klientów</li>';
  lista.hidden = false;
  pole.setAttribute('aria-expanded', 'true');
  pole.removeAttribute('aria-activedescendant');
}

function zamknij(pole) {
  const { lista } = elementy(pole);
  lista.hidden = true;
  pole.setAttribute('aria-expanded', 'false');
  pole.removeAttribute('aria-activedescendant');
}

/** Ustawia (albo czyści – id null) wybranego klienta. Zmiana ukrytego pola wywołuje „change” (odświeżenie formularza). */
function ustaw(pole, id, tekst) {
  const { ukryte, wyczysc, stan } = elementy(pole);
  const zmiana = ukryte.value !== (id ?? '') || Boolean(ukryte.dataset.wyczyszczone);
  delete ukryte.dataset.wyczyszczone;
  ukryte.value = id ?? '';
  pole.value = tekst ?? '';
  wyczysc.hidden = !id;
  stan.textContent = id ? '' : stan.closest('.wybor-klienta').dataset.pusto;
  zamknij(pole);
  if (zmiana) ukryte.dispatchEvent(new Event('change', { bubbles: true }));
}

function przesun(pole, krok) {
  const { lista } = elementy(pole);
  if (lista.hidden) pokaz(pole);
  const opcje = [...lista.querySelectorAll('[role="option"]')];
  if (!opcje.length) return;
  const obecna = opcje.findIndex((o) => o.id === pole.getAttribute('aria-activedescendant'));
  const nowa = opcje[(obecna + krok + opcje.length) % opcje.length];
  opcje.forEach((o) => o.setAttribute('aria-selected', String(o === nowa)));
  pole.setAttribute('aria-activedescendant', nowa.id);
  nowa.scrollIntoView({ block: 'nearest' });
}

let zainstalowane = false;

/** Nasłuchiwacze na dokumencie – raz, przy starcie aplikacji. */
export function instaluj(doc = document) {
  if (zainstalowane) return;
  zainstalowane = true;

  doc.addEventListener('focusin', (ev) => {
    // Z wybranym klientem lista się nie otwiera (także po przerysowaniu formularza, które przywraca fokus) –
    // otwiera ją pisanie albo strzałka w dół.
    if (ev.target.classList?.contains('wk-pole') && !elementy(ev.target).ukryte.value) pokaz(ev.target);
  });

  doc.addEventListener('input', (ev) => {
    const pole = ev.target;
    if (!pole.classList?.contains('wk-pole')) return;
    // Wpisywanie niczego nie wybiera; poprzedni wybór przestaje obowiązywać, dopóki nie dotkniesz pozycji.
    const { ukryte, wyczysc, stan } = elementy(pole);
    // Bez „change” w trakcie pisania – przerysowanie formularza skasowałoby wpisywany tekst; zgłoszenie przy wyjściu z pola.
    if (ukryte.value) {
      ukryte.value = '';
      wyczysc.hidden = true;
      ukryte.dataset.wyczyszczone = '1';
    }
    stan.textContent = pole.value.trim() ? 'Dotknij klienta na liście, żeby go wybrać.' : pole.closest('.wybor-klienta').dataset.pusto;
    pokaz(pole);
  });

  // Dotknięcie pozycji: mousedown/pointerdown bez utraty fokusu (inaczej lista zniknie przed kliknięciem).
  doc.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest?.('.wk-lista')) ev.preventDefault();
  });
  doc.addEventListener('click', (ev) => {
    const opcja = ev.target.closest?.('.wk-lista [role="option"]');
    if (opcja) {
      const pole = opcja.closest('.wybor-klienta').querySelector('.wk-pole');
      ustaw(pole, opcja.dataset.id, opcja.textContent);
      return;
    }
    const wyczysc = ev.target.closest?.('.wk-wyczysc');
    if (wyczysc) {
      const pole = wyczysc.closest('.wybor-klienta').querySelector('.wk-pole');
      ustaw(pole, null, '');
      pole.focus();
    }
  });

  doc.addEventListener('keydown', (ev) => {
    const pole = ev.target;
    if (!pole.classList?.contains('wk-pole')) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      przesun(pole, ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();   // Enter nie wysyła formularza importu
      const aktywna = pole.getAttribute('aria-activedescendant');
      const opcja = aktywna && document.getElementById(aktywna);
      if (opcja) ustaw(pole, opcja.dataset.id, opcja.textContent);
    } else if (ev.key === 'Escape') {
      zamknij(pole);
    }
  });

  // Wyjście z pola bez wyboru: tekst bez wybranego klienta znika (żeby nie wyglądało na wybrane).
  doc.addEventListener('focusout', (ev) => {
    const pole = ev.target;
    if (!pole.classList?.contains('wk-pole')) return;
    zamknij(pole);
    const { ukryte } = elementy(pole);
    if (!ukryte.value) pole.value = '';
    if (ukryte.dataset.wyczyszczone) {
      delete ukryte.dataset.wyczyszczone;
      ukryte.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
