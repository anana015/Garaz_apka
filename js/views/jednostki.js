// Jednostki (8.7): kafelki pogrupowane według typu i szczegóły jednostki.

import { TYPY_JEDNOSTEK } from '../config.js';
import { biezacyNajem, stawkaNaDzien } from '../dane.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import { esc, dzisiaj, formatData, formatM2, formatZl, normalizujTekst, porownajKody } from '../utils.js';

// Kolor i tekst statusu (8.7). „Zajęta” jest neutralna, dopóki nie liczymy sald:
// zielona „opłacona” i czerwona „zalega” dojdą w kroku 1c.
const STATUS = {
  wolna: { tekst: 'Wolna', klasa: 'wolna' },
  zajeta: { tekst: 'Zajęta', klasa: 'zajeta' },
  wylaczona: { tekst: 'Wyłączona', klasa: 'wylaczona' },
};

/** Status jednostki w dniu i bieżący najem z klientem. */
function opisJednostki(s, j, dzien) {
  const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzien);
  const umowa = najem && s.indeksy.umowy.get(najem.contract_id);
  const klient = umowa && s.indeksy.klienci.get(umowa.client_id);
  const status = j.out_of_service ? 'wylaczona' : najem ? 'zajeta' : 'wolna';
  const stawka = najem ? stawkaNaDzien(s.indeksy.stawkiNajmu.get(najem.id), dzien) : null;
  return { j, najem, klient, status, stawka };
}

const FILTRY = {
  wszystkie: { tekst: 'Wszystkie', warunek: () => true },
  wolne: { tekst: 'Wolne', warunek: (o) => o.status === 'wolna' },
  zajete: { tekst: 'Zajęte', warunek: (o) => o.status === 'zajeta' },
  zalegle: { tekst: 'Z zaległością', warunek: () => false },     // krok 1c
  wylaczone: { tekst: 'Wyłączone', warunek: (o) => o.status === 'wylaczona' },
};

function kafelek(o) {
  const st = STATUS[o.status];
  return `<a class="jednostka ${st.klasa}" href="#/jednostki/${encodeURIComponent(o.j.id)}">
    <strong>${esc(o.j.code)}</strong>
    <span class="status ${st.klasa}">${st.tekst}</span>
    <span>${[formatM2(o.j.area_m2), o.stawka != null ? formatZl(o.stawka, { grosze: false }) : ''].filter(Boolean).join(' · ')}</span>
    ${o.klient ? `<span>${esc(o.klient.name)}</span>` : ''}
  </a>`;
}

function lista(s) {
  const dzien = dzisiaj();
  const akcje = `<div class="pasek-akcji">${przycisk({ tekst: 'Dodaj jednostkę', akcja: 'nowa', ikona: 'plus' })}</div>`;
  const aktywne = s.dane.units.filter((j) => !j.archived);
  if (!aktywne.length) {
    return akcje + pustyStan('Nie ma jeszcze jednostek. Dodaj pierwszą albo wczytaj dane startowe.', [
      { tekst: 'Wczytaj dane startowe', href: '#/ustawienia', drugi: true }]);
  }

  const filtr = s.ui.filtry.jednostki ?? 'wszystkie';
  const szukane = normalizujTekst(s.ui.szukaj.jednostki);
  const opisy = aktywne.map((j) => opisJednostki(s, j, dzien));
  const widoczne = opisy
    .filter((o) => FILTRY[filtr].warunek(o))
    .filter((o) => !szukane || normalizujTekst(`${o.j.code} ${o.klient?.name ?? ''}`).includes(szukane));

  let tresc;
  if (filtr === 'zalegle') tresc = wPlanie('Filtr „Z zaległością” powstanie razem z rozliczeniami – krok 1c.');
  else if (!widoczne.length) {
    tresc = pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.'
      : filtr === 'wolne' ? 'Wszystkie jednostki są wynajęte.' : 'Brak jednostek w tym widoku.');
  } else {
    tresc = Object.entries(TYPY_JEDNOSTEK).map(([typ, nazwy]) => {
      const grupa = widoczne.filter((o) => o.j.type === typ)
        .sort((a, b) => a.j.sort_order - b.j.sort_order || porownajKody(a.j.code, b.j.code));
      return grupa.length ? `<section class="grupa" aria-labelledby="g-${typ}">
        <h2 id="g-${typ}">${nazwy.mnoga} <span class="wyciszony maly">${grupa.length}</span></h2>
        <div class="jednostki">${grupa.map(kafelek).join('')}</div></section>` : '';
    }).join('');
  }

  const liczbaWolnych = opisy.filter((o) => o.status === 'wolna').length;
  const opcje = Object.entries(FILTRY).map(([id, f]) => ({
    id, tekst: f.tekst, liczba: id === 'wolne' ? liczbaWolnych : undefined }));

  return `${akcje}
    ${filtry(opcje, filtr, 'Status jednostek')}
    ${poleSzukaj('jednostki', s.ui.szukaj.jednostki, 'Szukaj po numerze albo kliencie')}
    ${tresc}`;
}

function szczegoly(s, j) {
  const dzien = dzisiaj();
  const o = opisJednostki(s, j, dzien);
  const historia = [...(s.indeksy.najmyJednostki.get(j.id) ?? [])].sort((a, b) => b.start_on.localeCompare(a.start_on));
  const klientNajmu = (n) => s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);

  return `
    <div class="siatka">
      <section class="karta" aria-labelledby="j-dane"><h2 id="j-dane">Dane</h2>
        <dl class="opis-pol">
          <dt>Typ</dt><dd>${esc(TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type)}</dd>
          <dt>Status</dt><dd><span class="status ${STATUS[o.status].klasa}">${STATUS[o.status].tekst}</span></dd>
          ${formatM2(j.area_m2) ? `<dt>Powierzchnia</dt><dd>${formatM2(j.area_m2)}</dd>` : ''}
          <dt>Cennik</dt><dd class="kwota">${j.list_price_gr != null ? formatZl(j.list_price_gr) : '—'}</dd>
        </dl>
        ${j.description ? `<p class="wyciszony">${esc(j.description)}</p>` : ''}
      </section>
      <section class="karta" aria-labelledby="j-najem"><h2 id="j-najem">Bieżący najem</h2>
        ${o.najem ? `<dl class="opis-pol">
          <dt>Klient</dt><dd>${o.klient ? `<a href="#/klienci/${encodeURIComponent(o.klient.id)}">${esc(o.klient.name)}</a>` : '—'}</dd>
          <dt>Od</dt><dd>${formatData(o.najem.start_on)}</dd>
          <dt>Stawka</dt><dd class="kwota">${o.stawka != null ? formatZl(o.stawka) : '—'}</dd>
        </dl>` : '<p class="wyciszony">Jednostka jest wolna.</p>'}
      </section>
      <section class="karta" aria-labelledby="j-historia"><h2 id="j-historia">Historia najmów</h2>
        ${historia.length ? `<ul class="lista">${historia.map((n) => `<li><div class="wiersz"><div class="glowna">
          <strong>${esc(klientNajmu(n)?.name ?? '—')}</strong>
          <span>${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'}</span></div></div></li>`).join('')}</ul>`
          : '<p class="wyciszony">Jednostka nie była jeszcze wynajmowana.</p>'}
      </section>
    </div>
    ${wPlanie('Przychód z 12 miesięcy, dni pustostanu i akcje Wynajmij / Edytuj / Wyłącz – kroki 1a i 1c.')}`;
}

export default {
  tytul(s) {
    if (!s.ui.parametr) return 'Jednostki';
    return s.indeksy.jednostki.get(s.ui.parametr)?.code ?? 'Jednostka';
  },

  wstecz: (s) => (s.ui.parametr ? { href: '#/jednostki', tekst: 'Jednostki' } : null),

  render(s) {
    if (!s.ui.parametr) return lista(s);
    const j = s.indeksy.jednostki.get(s.ui.parametr);
    return j ? szczegoly(s, j) : pustyStan('Nie znaleziono jednostki.', [{ tekst: 'Wróć do listy', href: '#/jednostki' }]);
  },

  akcje: {
    nowa(_el, ctx) {
      ctx.toast('Formularz jednostki – następna część kroku 1a.');
    },
  },
};
