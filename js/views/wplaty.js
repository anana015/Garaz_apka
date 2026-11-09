// Wpłaty (8.2): filtry, wyszukiwanie, lista. Przypisywanie i menu wiersza – krok 1b.

import { doPrzypisania } from '../dane.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import { esc, formatZl, formatData, normalizujTekst, kluczMiesiaca, etykietaMiesiaca } from '../utils.js';
import { wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const FILTRY = {
  wszystkie: { tekst: 'Wszystkie', warunek: (w, s) => kluczMiesiaca(w.booked_on) === s.ui.miesiac },
  'do-przypisania': { tekst: 'Do przypisania', warunek: (w) => w.kind === 'czynsz' && !w.client_id },
  gotowka: { tekst: 'Gotówka', warunek: (w) => w.method === 'gotowka' },
  kaucje: { tekst: 'Kaucje', warunek: (w) => w.kind === 'kaucja' },
  pominiete: { tekst: 'Pominięte', warunek: (w) => w.kind === 'pominieta' },
};

const PUSTE = {
  wszystkie: (s) => `Brak wpłat w miesiącu ${etykietaMiesiaca(s.ui.miesiac)}.`,
  'do-przypisania': () => 'Wszystkie wpłaty są przypisane.',
  gotowka: () => 'Brak wpłat gotówkowych.',
  kaucje: () => 'Brak kaucji wpłaconych przelewem.',
  pominiete: () => 'Brak pominiętych wpłat.',
};

function wiersz(w, s) {
  const klient = w.client_id ? s.indeksy.klienci.get(w.client_id) : null;
  const nadawca = w.method === 'gotowka' ? 'gotówka' : (w.counterparty || '—');
  const kogo = klient
    ? esc(klient.name)
    : w.kind === 'czynsz' ? '<span class="status czesciowo">Do przypisania</span>' : '';
  return `<li><div class="wiersz">
    <div class="glowna"><strong>${esc(nadawca)}</strong>
      <span>${formatData(w.booked_on)}${w.title ? ` · ${esc(w.title)}` : ''}</span></div>
    <div class="prawa"><div class="kwota">${formatZl(w.amount_gr)}</div><div class="maly">${kogo}</div></div>
  </div></li>`;
}

export default {
  tytul: () => 'Wpłaty',

  render(s) {
    const wszystkie = s.dane.payments;
    const akcje = `<div class="pasek-akcji">
      ${przycisk({ tekst: 'Wczytaj wyciąg', href: '#/import', ikona: 'import' })}
      ${przycisk({ tekst: 'Dodaj wpłatę gotówką', akcja: 'gotowka', drugi: true, ikona: 'plus' })}</div>`;
    if (!wszystkie.length) {
      return akcje + pustyStan('Nie ma jeszcze wpłat. Wczytaj wyciąg z banku albo dodaj wpłatę gotówką.');
    }

    const filtr = s.ui.filtry.wplaty ?? 'wszystkie';
    const szukane = normalizujTekst(s.ui.szukaj.wplaty);
    const lista = wszystkie
      .filter((w) => FILTRY[filtr].warunek(w, s))
      .filter((w) => !szukane || normalizujTekst(
        `${w.counterparty ?? ''} ${w.title ?? ''} ${formatZl(w.amount_gr, { waluta: false })}`).includes(szukane))
      .sort((a, b) => b.booked_on.localeCompare(a.booked_on) || b.created_at.localeCompare(a.created_at));

    const opcje = Object.entries(FILTRY).map(([id, f]) => ({
      id, tekst: f.tekst, liczba: id === 'do-przypisania' ? doPrzypisania(wszystkie).length : undefined,
    }));

    return `${akcje}
      ${filtry(opcje, filtr, 'Rodzaj wpłat')}
      ${filtr === 'wszystkie' ? wyborMiesiaca(s) : ''}
      ${poleSzukaj('wplaty', s.ui.szukaj.wplaty, 'Szukaj po nadawcy, tytule, kwocie')}
      <section class="karta">
        ${lista.length ? `<ul class="lista">${lista.map((w) => wiersz(w, s)).join('')}</ul>`
          : pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.' : PUSTE[filtr](s))}
      </section>
      ${wPlanie('Przypisywanie do klienta, „Zapamiętaj płatnika” i menu wiersza – krok 1b.')}`;
  },

  akcje: {
    gotowka(_el, ctx) {
      ctx.toast('Formularz wpłaty gotówką pojawi się w kroku 1b.');
    },
  },

  poRenderze: pokazWybranyMiesiac,
};
