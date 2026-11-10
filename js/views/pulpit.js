// Pulpit (8.1): „Jak wygląda wybrany miesiąc i kto zalega?”
// Kwoty i listy wymagają okresy.js i rozliczenia.js – krok 1c.

import { doPrzypisania } from '../dane.js';
import { pustyStan, wPlanie } from '../ui.js';
import { MIESIACE_W, odmiana } from '../utils.js';
import { wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

function kafelek(etykieta, wartosc, opis) {
  return `<div class="kafelek"><span class="etykieta">${etykieta}</span>
    <span class="wartosc">${wartosc}</span><span class="opis">${opis}</span></div>`;
}

function paskiOstrzezen(s) {
  const paski = [];
  const n = doPrzypisania(s.dane.payments).length;
  if (n) {
    paski.push(`<button type="button" class="baner ostrzezenie pelny-wiersz" data-akcja="idz"
      data-ekran="wplaty" data-filtr="do-przypisania">${odmiana(n, ['wpłata czeka', 'wpłaty czekają', 'wpłat czeka'])} na przypisanie ›</button>`);
  }
  // Kolejne paski (kończące się umowy, ryczałt, brak importu, limit VAT) – kroki 1c i 1d.
  return paski.join('');
}

export default {
  tytul: () => 'Pulpit',

  render(s) {
    const d = s.dane;
    if (!d.units.length && !d.clients.length) {
      return pustyStan('Zacznij od dodania jednostek i klientów albo wczytaj dane startowe.', [
        { tekst: 'Dodaj jednostkę', href: '#/jednostki/nowa' },
        { tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true },
      ]);
    }
    const miesiacW = MIESIACE_W[Number(s.ui.miesiac.slice(5, 7)) - 1];
    return `
      ${wyborMiesiaca(s)}
      ${paskiOstrzezen(s)}
      <div class="kafelki">
        ${kafelek('Należne', '—', 'należności w miesiącu')}
        ${kafelek('Wpłynęło', '—', 'przychód kasowy')}
        ${kafelek('Brakuje', '—', 'przelewy i kwota')}
        ${kafelek('Zaległości razem', '—', 'wszyscy klienci')}
      </div>
      <div class="siatka">
        <section class="karta" aria-labelledby="k-brakujace"><h2 id="k-brakujace">Brakujące wpłaty w ${miesiacW}</h2>
          ${wPlanie('Lista klientów z terminem i liczbą dni po terminie – krok 1c.')}</section>
        <section class="karta" aria-labelledby="k-dluznicy"><h2 id="k-dluznicy">Najwięksi dłużnicy</h2>
          ${wPlanie('5 klientów z kwotą, dniami po terminie i obietnicą zapłaty – krok 1c.')}</section>
        <section class="karta" aria-labelledby="k-ryczalt"><h2 id="k-ryczalt">Ryczałt</h2>
          ${wPlanie('Przychód kwartału, ryczałt i pasek progu 100 000 zł – krok 1d.')}</section>
        <section class="karta" aria-labelledby="k-oblozenie"><h2 id="k-oblozenie">Obłożenie</h2>
          ${wPlanie('Zajęte jednostki i wolne według typu – krok 1c.')}</section>
      </div>`;
  },

  poRenderze: pokazWybranyMiesiac,
};
