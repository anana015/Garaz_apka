// Jednostki (8.7): kafelki pogrupowane według typu, szczegóły jednostki i formularz jednostki (8.6).
// Adresy: #/jednostki, #/jednostki/nowa, #/jednostki/<id>, #/jednostki/<id>/edycja

import { TYPY_JEDNOSTEK } from '../config.js';
import { biezacyNajem, stawkaNaDzien } from '../dane.js';
import { formularz, maBledy, obszar, pole, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, formatData, formatDataKrotka, formatM2, formatZl, kwotaDoPola, nastepnyNumer, normalizujTekst,
  porownajKody, roznicaDni,
} from '../utils.js';
import { walidujJednostke } from '../walidacja.js';
import { ustawienia } from './wspolne.js';

// Kolor i tekst statusu (8.7). „Zajęta” jest neutralna, dopóki nie liczymy sald:
// zielona „opłacona” i czerwona „zalega” dojdą w kroku 1c.
const STATUS = {
  wolna: { tekst: 'Wolna', klasa: 'wolna' },
  zajeta: { tekst: 'Zajęta', klasa: 'zajeta' },
  wylaczona: { tekst: 'Wyłączona', klasa: 'wylaczona' },
};

/** Status jednostki w dniu, bieżący najem z klientem i umową. */
function opisJednostki(s, j, dzien) {
  const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzien);
  const umowa = najem && s.indeksy.umowy.get(najem.contract_id);
  const klient = umowa && s.indeksy.klienci.get(umowa.client_id);
  const status = j.out_of_service ? 'wylaczona' : najem ? 'zajeta' : 'wolna';
  const stawka = najem ? stawkaNaDzien(s.indeksy.stawkiNajmu.get(najem.id), dzien) : null;
  return { j, najem, umowa, klient, status, stawka };
}

/**
 * Znacznik „umowa kończy się” (8.7, Z10): umowa na czas określony kończy się w ciągu
 * settings.expiring_days dni albo już wygasła, a najem trwa. null, gdy nie dotyczy.
 */
export function koniecUmowy(umowa, najem, s, dzien = dzisiaj()) {
  if (!umowa?.valid_until || !najem || najem.end_on) return null;
  const dni = roznicaDni(dzien, umowa.valid_until);
  if (dni < 0) return { tekst: `umowa wygasła ${formatDataKrotka(umowa.valid_until)}`, wygasla: true };
  if (dni <= ustawienia(s).expiring_days) return { tekst: `umowa do ${formatDataKrotka(umowa.valid_until)}`, wygasla: false };
  return null;
}

const FILTRY = {
  wszystkie: { tekst: 'Wszystkie', warunek: () => true },
  wolne: { tekst: 'Wolne', warunek: (o) => o.status === 'wolna' },
  zajete: { tekst: 'Zajęte', warunek: (o) => o.status === 'zajeta' },
  zalegle: { tekst: 'Z zaległością', warunek: () => false },     // krok 1c
  wylaczone: { tekst: 'Wyłączone', warunek: (o) => o.status === 'wylaczona' },
};

function kafelek(o, s) {
  const st = STATUS[o.status];
  const umowa = koniecUmowy(o.umowa, o.najem, s);
  return `<a class="jednostka ${st.klasa}" href="#/jednostki/${encodeURIComponent(o.j.id)}">
    <strong>${esc(o.j.code)}</strong>
    <span class="status ${st.klasa}">${st.tekst}</span>
    <span>${[formatM2(o.j.area_m2), o.stawka != null ? formatZl(o.stawka, { grosze: false }) : ''].filter(Boolean).join(' · ')}</span>
    ${o.klient ? `<span>${esc(o.klient.name)}</span>` : ''}
    ${umowa ? `<span class="znacznik${umowa.wygasla ? ' pilne' : ''}">${esc(umowa.tekst)}</span>` : ''}
  </a>`;
}

function lista(s) {
  const dzien = dzisiaj();
  const aktywne = s.dane.units.filter((j) => !j.archived);
  const akcje = `<div class="pasek-akcji">
    ${przycisk({ tekst: 'Dodaj jednostkę', href: '#/jednostki/nowa', ikona: 'plus' })}
    ${aktywne.length ? przycisk({ tekst: 'Zmień stawki', href: '#/najmy/podwyzka', drugi: true }) : ''}</div>`;
  if (!aktywne.length) {
    return akcje + pustyStan('Nie ma jeszcze jednostek. Dodaj pierwszą albo wczytaj dane startowe.', [
      { tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true }]);
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
        <div class="jednostki">${grupa.map((o) => kafelek(o, s)).join('')}</div></section>` : '';
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
  const umowa = koniecUmowy(o.umowa, o.najem, s, dzien);

  // Pustostan (5.8): dni od końca ostatniego najmu wolnej jednostki.
  const ostatniKoniec = historia.filter((n) => n.end_on && n.end_on < dzien).map((n) => n.end_on).sort().at(-1);
  const pustostan = o.status === 'wolna' && ostatniKoniec ? roznicaDni(ostatniKoniec, dzien) : null;

  const akcje = [
    o.status === 'wolna' ? przycisk({ tekst: 'Wynajmij', href: `#/najmy/nowy?jednostka=${encodeURIComponent(j.id)}`, ikona: 'plus' }) : '',
    przycisk({ tekst: 'Edytuj', href: `#/jednostki/${encodeURIComponent(j.id)}/edycja`, drugi: true }),
    !o.najem ? `<button type="button" class="przycisk drugi" data-akcja="wylacz" data-id="${esc(j.id)}">${
      j.out_of_service ? 'Przywróć do najmu' : 'Wyłącz z najmu'}</button>` : '',
  ].join('');

  return `
    <div class="pasek-akcji">${akcje}</div>
    <div class="siatka">
      <section class="karta" aria-labelledby="j-dane"><h2 id="j-dane">Dane</h2>
        <dl class="opis-pol">
          <dt>Typ</dt><dd>${esc(TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type)}</dd>
          <dt>Status</dt><dd><span class="status ${STATUS[o.status].klasa}">${STATUS[o.status].tekst}</span></dd>
          ${formatM2(j.area_m2) ? `<dt>Powierzchnia</dt><dd>${formatM2(j.area_m2)}</dd>` : ''}
          <dt>Cennik</dt><dd class="kwota">${j.list_price_gr != null ? formatZl(j.list_price_gr) : '—'}</dd>
          ${pustostan != null ? `<dt>Pustostan</dt><dd>${pustostan} dni</dd>` : ''}
        </dl>
        ${j.description ? `<p class="wyciszony">${esc(j.description)}</p>` : ''}
      </section>
      <section class="karta" aria-labelledby="j-najem"><h2 id="j-najem">Bieżący najem</h2>
        ${o.najem ? `<dl class="opis-pol">
          <dt>Klient</dt><dd>${o.klient ? `<a href="#/klienci/${encodeURIComponent(o.klient.id)}">${esc(o.klient.name)}</a>` : '—'}</dd>
          <dt>Od</dt><dd>${formatData(o.najem.start_on)}</dd>
          <dt>Stawka</dt><dd class="kwota">${o.stawka != null ? formatZl(o.stawka) : '—'}</dd>
          ${o.umowa?.valid_until ? `<dt>Umowa do</dt><dd>${formatData(o.umowa.valid_until)}${umowa
            ? ` <span class="znacznik${umowa.wygasla ? ' pilne' : ''}">${umowa.wygasla ? 'wygasła' : 'kończy się'}</span>` : ''}</dd>` : ''}
        </dl>` : `<p class="wyciszony">${j.out_of_service ? 'Jednostka jest wyłączona z najmu.' : 'Jednostka jest wolna.'}</p>`}
      </section>
      <section class="karta" aria-labelledby="j-historia"><h2 id="j-historia">Historia najmów</h2>
        ${historia.length ? `<ul class="lista">${historia.map((n) => {
          const k = klientNajmu(n);
          const stawka = stawkaNaDzien(s.indeksy.stawkiNajmu.get(n.id), n.end_on && n.end_on < dzien ? n.end_on : dzien);
          return `<li><div class="wiersz"><div class="glowna">
            <strong>${k ? `<a href="#/klienci/${encodeURIComponent(k.id)}">${esc(k.name)}</a>` : '—'}</strong>
            <span>${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'}</span></div>
            <div class="prawa kwota">${stawka != null ? formatZl(stawka) : '—'}</div></div></li>`;
        }).join('')}</ul>`
          : '<p class="wyciszony">Jednostka nie była jeszcze wynajmowana.</p>'}
      </section>
    </div>
    ${wPlanie('Przychód z jednostki za 12 miesięcy – krok 1c (rozliczenia wpłat).')}`;
}

// ---------------------------------------------------------------------
// Formularz jednostki (8.6)
// ---------------------------------------------------------------------

const kluczFormularza = (s) => `jednostki/${s.ui.parametr}/${s.ui.akcja ?? ''}`;

function wartosciJednostki(j) {
  if (!j) return { type: '', out_of_service: '' };
  return {
    code: j.code, type: j.type,
    area_m2: j.area_m2 != null ? String(Number(j.area_m2)).replace('.', ',') : '',
    list_price_gr: kwotaDoPola(j.list_price_gr), description: j.description ?? '',
    out_of_service: j.out_of_service ? 'on' : '',
  };
}

function formularzJednostki(s, j) {
  const f = stanFormularza(s, kluczFormularza(s), () => wartosciJednostki(j));
  const typy = Object.entries(TYPY_JEDNOSTEK).map(([id, t]) => ({ wartosc: id, tekst: t.nazwa }));
  return formularz(f, {
    nazwa: 'jednostka',
    przycisk: j ? 'Zapisz zmiany' : 'Dodaj jednostkę',
    drugiPrzycisk: j ? null : { tekst: 'Dodaj i wpisz kolejną', wartosc: 'kolejna' },
    anuluj: j ? `#/jednostki/${encodeURIComponent(j.id)}` : '#/jednostki',
    tresc: `
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'code', etykieta: 'Numer', wymagane: true, podpowiedz: 'Np. G-03, do 12 znaków.',
          atrybuty: 'maxlength="12" autocomplete="off" autocapitalize="characters"' })}
        ${wybor(f, { nazwa: 'type', etykieta: 'Typ', opcje: typy, wymagane: true, pusta: 'Wybierz…' })}
      </div>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'area_m2', etykieta: 'Powierzchnia (m²)', atrybuty: 'inputmode="decimal" autocomplete="off"' })}
        ${pole(f, { nazwa: 'list_price_gr', etykieta: 'Cena z cennika (zł / mies.)', typ: 'kwota',
          podpowiedz: 'Podpowiadana przy nowym najmie. Zmiana nie zmienia trwających najmów (Z12).' })}
      </div>
      ${obszar(f, { nazwa: 'description', etykieta: 'Opis', wiersze: 2 })}
      ${przelacznik(f, { nazwa: 'out_of_service', etykieta: 'Wyłączona z najmu (np. remont)',
        podpowiedz: 'Nie liczy się do obłożenia i nie można jej wynająć.' })}`,
  });
}

export default {
  tytul(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return 'Jednostki';
    if (parametr === 'nowa') return 'Nowa jednostka';
    const kod = s.indeksy.jednostki.get(parametr)?.code ?? 'Jednostka';
    return akcja === 'edycja' ? `Edycja ${kod}` : kod;
  },

  wstecz(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return null;
    if (akcja === 'edycja') {
      return { href: `#/jednostki/${encodeURIComponent(parametr)}`, tekst: s.indeksy.jednostki.get(parametr)?.code ?? 'Jednostka' };
    }
    return { href: '#/jednostki', tekst: 'Jednostki' };
  },

  render(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return lista(s);
    if (parametr === 'nowa') return formularzJednostki(s, null);
    const j = s.indeksy.jednostki.get(parametr);
    if (!j) return pustyStan('Nie znaleziono jednostki.', [{ tekst: 'Wróć do listy', href: '#/jednostki' }]);
    return akcja === 'edycja' ? formularzJednostki(s, j) : szczegoly(s, j);
  },

  akcje: {
    /** Wyłącz z najmu / przywróć (8.7). Wynajętej nie da się wyłączyć – przycisk jest wtedy ukryty. */
    async wylacz(el, ctx) {
      const j = ctx.state.indeksy.jednostki.get(el.dataset.id);
      if (!j || ctx.state.podglad) return;
      el.setAttribute('aria-disabled', 'true');
      try {
        const zapisana = await ctx.db.zmien('units', j.id, { out_of_service: !j.out_of_service });
        ctx.scal({ units: [zapisana] });
        ctx.toast(zapisana.out_of_service ? `${j.code} wyłączona z najmu` : `${j.code} znów do wynajęcia`);
        ctx.render();
      } catch (e) {
        el.removeAttribute('aria-disabled');
        ctx.toast(e.message);
      }
    },
  },

  formularze: {
    async jednostka(form, ctx, ev) {
      const s = ctx.state;
      const j = s.ui.parametr === 'nowa' ? null : s.indeksy.jednostki.get(s.ui.parametr);
      const w = wartosciFormularza(form);
      const wynajeta = j ? Boolean(biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzisiaj())) : false;
      const { bledy, wiersz } = walidujJednostke(w, { jednostki: s.dane.units, id: j?.id ?? null, wynajeta });
      if (maBledy(ctx, w, bledy)) return;
      const kolejna = ev.submitter?.value === 'kolejna';

      await zapisz(ctx, async () => {
        const zapisana = j ? await ctx.db.zmien('units', j.id, wiersz) : await ctx.db.wstaw('units', wiersz);
        ctx.scal({ units: [zapisana] });
        if (kolejna) {
          // Seria jednostek: ten sam typ i cena, numer o jeden większy.
          Object.assign(s.ui.form, {
            wartosci: { type: wiersz.type, list_price_gr: w.list_price_gr, area_m2: w.area_m2, code: nastepnyNumer(zapisana.code) },
            bledy: {}, trwa: false,
          });
          ctx.toast(`Dodano jednostkę ${zapisana.code}`);
          ctx.render();
          document.getElementById('f-code')?.focus();
          return;
        }
        ctx.toast(j ? `Zapisano ${zapisana.code}` : `Dodano jednostkę ${zapisana.code}`);
        ctx.nawiguj(`jednostki/${encodeURIComponent(zapisana.id)}`);
      });
    },
  },
};
