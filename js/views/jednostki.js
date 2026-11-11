// Jednostki (8.7): kafelki pogrupowane według typu, szczegóły jednostki i formularz jednostki (8.6).
// Adresy: #/jednostki, #/jednostki/nowa, #/jednostki/<id>, #/jednostki/<id>/edycja

import { TYPY_JEDNOSTEK } from '../config.js';
import { biezacyNajem, opisPlatnosci, stawkaNaDzien } from '../dane.js';
import { formularz, maBledy, obszar, pole, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie, przyciskEdycji } from '../ui.js';
import { promocjaNajmu } from '../promocje.js';
import { grupa, grupaNajmu, kartaUstawien, menu, pozycja } from './edycja.js';
import {
  esc, dzisiaj, formatData, formatDataKrotka, formatM2, formatZl, kwotaDoPola, nastepnyNumer, normalizujTekst,
  porownajKody, roznicaDni,
} from '../utils.js';
import { walidujJednostke } from '../walidacja.js';
import { rozliczeniaKlientow, ustawienia } from './wspolne.js';

// Kolor i tekst statusu (8.7): zajęta jednostka jest „opłacona” (zielona) albo „zalega” (czerwona).
const STATUS = {
  wolna: { tekst: 'Wolna', klasa: 'wolna' },
  zajeta: { tekst: 'Zajęta', klasa: 'zajeta' },
  oplacona: { tekst: 'Opłacona', klasa: 'ok' },
  zalega: { tekst: 'Zalega', klasa: 'zalega' },
  wylaczona: { tekst: 'Wyłączona', klasa: 'wylaczona' },
};

/** Status jednostki w dniu, bieżący najem z klientem i umową. */
function opisJednostki(s, j, dzien) {
  const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzien);
  const umowa = najem && s.indeksy.umowy.get(najem.contract_id);
  const klient = umowa && s.indeksy.klienci.get(umowa.client_id);
  const stawka = najem ? stawkaNaDzien(s.indeksy.stawkiNajmu.get(najem.id), dzien) : null;
  // Zaległość najmu: niezapłacone należności tej jednostki z terminem przed dziś (rozliczenie klienta, 5.3).
  let zalegloscGr = 0;
  let oplaconeDo = null;
  if (najem && klient) {
    const r = rozliczeniaKlientow(s).get(klient.id);
    zalegloscGr = (r?.pozycje ?? []).filter((p) => p.najemId === najem.id && p.termin < dzien)
      .reduce((x, p) => x + p.kwotaGr - p.zaplaconoGr, 0);
    oplaconeDo = r?.oplaconeDo.get(najem.id) ?? null;
  }
  let status = 'wolna';
  if (j.out_of_service) status = 'wylaczona';
  else if (najem) status = zalegloscGr > 0 ? 'zalega' : 'oplacona';
  const promo = najem ? promocjaNajmu(s.indeksy.stawkiNajmu.get(najem.id) ?? [], dzien) : null;
  const wypowiedzenie = najem && !najem.end_on && najem.notice_end_on ? najem.notice_end_on : null;
  return { j, najem, umowa, klient, status, stawka, zalegloscGr, oplaconeDo, promo, wypowiedzenie };
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
  zajete: { tekst: 'Zajęte', warunek: (o) => Boolean(o.najem) && !o.j.out_of_service },
  zalegle: { tekst: 'Z zaległością', warunek: (o) => o.status === 'zalega' },
  wylaczone: { tekst: 'Wyłączone', warunek: (o) => o.status === 'wylaczona' },
  konczace: { tekst: 'Kończące się umowy', warunek: (o, s) => Boolean(koniecUmowy(o.umowa, o.najem, s)) },
  wypowiedziane: { tekst: 'Wypowiedziane', warunek: (o) => Boolean(o.wypowiedzenie) },
  promocje: { tekst: 'W promocji', warunek: (o) => Boolean(o.promo) },
};

function kafelek(o, s) {
  const st = STATUS[o.status];
  const umowa = koniecUmowy(o.umowa, o.najem, s);
  return `<a class="jednostka ${st.klasa}" href="#/jednostki/${encodeURIComponent(o.j.id)}">
    <strong>${esc(o.j.code)}</strong>
    <span class="status ${st.klasa}">${o.status === 'zalega' ? `zalega ${formatZl(o.zalegloscGr, { grosze: false })}`
    : o.status === 'oplacona' && o.oplaconeDo ? `opłacona do ${formatDataKrotka(o.oplaconeDo)}` : st.tekst}</span>
    <span>${[formatM2(o.j.area_m2), o.stawka != null ? formatZl(o.stawka, { grosze: false }) : ''].filter(Boolean).join(' · ')}</span>
    ${o.klient ? `<span>${esc(o.klient.name)}</span>` : ''}
    ${o.wypowiedzenie ? `<span class="znacznik${o.wypowiedzenie < dzisiaj() ? ' pilne' : ''}">wypowiedziana do ${formatDataKrotka(o.wypowiedzenie)}</span>` : ''}
    ${o.promo ? `<span class="znacznik promocja">${o.promo.do ? `promocja do ${formatDataKrotka(o.promo.do)}` : 'promocja'}</span>` : ''}
    ${umowa ? `<span class="znacznik${umowa.wygasla ? ' pilne' : ''}">${esc(umowa.tekst)}</span>` : ''}
  </a>`;
}

function lista(s) {
  const dzien = dzisiaj();
  const aktywne = s.dane.units.filter((j) => !j.archived);
  // Dodawanie jednostek i zmiana stawek wielu najmów – rzadko, więc w Ustawieniach (karta „Jednostki i stawki”).
  if (!aktywne.length) {
    return pustyStan('Nie ma jeszcze jednostek. Dodaj je w Ustawieniach albo wczytaj dane startowe.', [
      { tekst: 'Dodaj jednostkę', href: '#/jednostki/nowa' },
      { tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true }]);
  }

  const filtr = s.ui.filtry.jednostki ?? 'wszystkie';
  const szukane = normalizujTekst(s.ui.szukaj.jednostki);
  const opisy = aktywne.map((j) => opisJednostki(s, j, dzien));
  const widoczne = opisy
    .filter((o) => FILTRY[filtr].warunek(o, s))
    .filter((o) => !szukane || normalizujTekst(`${o.j.code} ${o.klient?.name ?? ''}`).includes(szukane));

  // Grupy typów są zwijane; przy wyszukiwaniu albo filtrze innym niż „Wszystkie” – rozwinięte.
  const rozwiniete = s.ui.grupyJednostek ?? (s.ui.grupyJednostek = new Set());
  const wszystkieOtwarte = Boolean(szukane) || filtr !== 'wszystkie';
  let tresc;
  if (!widoczne.length) {
    tresc = pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.'
      : filtr === 'wolne' ? 'Wszystkie jednostki są wynajęte.' : 'Brak jednostek w tym widoku.');
  } else {
    tresc = Object.entries(TYPY_JEDNOSTEK).map(([typ, nazwy]) => {
      const grupa = widoczne.filter((o) => o.j.type === typ)
        .sort((a, b) => a.j.sort_order - b.j.sort_order || porownajKody(a.j.code, b.j.code));
      if (!grupa.length) return '';
      const wolne = grupa.filter((o) => o.status === 'wolna').length;
      const zalega = grupa.filter((o) => o.status === 'zalega').length;
      const otwarta = wszystkieOtwarte || rozwiniete.has(typ);
      return `<details class="grupa" data-typ="${typ}"${otwarta ? ' open' : ''}>
        <summary><h2>${nazwy.mnoga}</h2><span class="wyciszony maly">${grupa.length}</span>
          ${wolne ? `<span class="status wolna maly">${wolne} wolne</span>` : ''}
          ${zalega ? `<span class="status zalega maly">${zalega} zalega</span>` : ''}</summary>
        <div class="jednostki">${grupa.map((o) => kafelek(o, s)).join('')}</div></details>`;
    }).join('');
  }

  const liczbaWolnych = opisy.filter((o) => o.status === 'wolna').length;
  const liczbaZaleglych = opisy.filter((o) => o.status === 'zalega').length;
  const opcje = Object.entries(FILTRY).map(([id, f]) => ({
    id, tekst: f.tekst, liczba: id === 'wolne' ? liczbaWolnych : id === 'zalegle' ? liczbaZaleglych
      : ['wypowiedziane', 'promocje'].includes(id) ? opisy.filter((o) => f.warunek(o, s)).length : undefined }))
    // Filtry bez trafień (wypowiedziane, w promocji) nie zajmują miejsca – chyba że są wybrane.
    .filter((o) => o.liczba !== 0 || o.id === filtr || !['wypowiedziane', 'promocje'].includes(o.id));

  return `
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

  if (s.ui.edycja) return ustawieniaJednostki(s, j, o, historia, dzien);
  const akcje = [
    o.status === 'wolna' ? przycisk({ tekst: 'Wynajmij', href: `#/najmy/nowy?jednostka=${encodeURIComponent(j.id)}`, ikona: 'plus' }) : '',
    przyciskEdycji(s),
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
          <dt>Płaci</dt><dd>${esc(opisPlatnosci(o.najem, s.indeksy.konta))}</dd>
          ${o.promo ? `<dt>Promocja</dt><dd>${o.promo.do ? `do ${formatData(o.promo.do)}` : 'do końca najmu'}</dd>` : ''}
          ${o.wypowiedzenie ? `<dt>Wypowiedziana</dt><dd>${o.najem.notice_given_on ? `złożona ${formatData(o.najem.notice_given_on)} · ` : ''}koniec najmu
            <strong>${formatData(o.wypowiedzenie)}</strong></dd>` : ''}
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

/** Tryb „Edytuj” jednostki: zwarte ustawienia z rozwijanymi grupami (jak na karcie klienta). */
function ustawieniaJednostki(s, j, o, historia, dzien) {
  const id = encodeURIComponent(j.id);
  const dane = [TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type, formatM2(j.area_m2),
    j.list_price_gr != null ? `cennik ${formatZl(j.list_price_gr)}` : null].filter(Boolean).map(esc).join(' · ');
  const klientNajmu = (n) => s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);
  const tresc = `
    ${grupa('Dane jednostki', dane, `<dl class="opis-pol">
        <dt>Numer</dt><dd class="mono">${esc(j.code)}</dd>
        ${j.description ? `<dt>Opis</dt><dd>${esc(j.description)}</dd>` : ''}
      </dl>
      ${menu([pozycja({ tekst: 'Edytuj dane jednostki', href: `#/jednostki/${id}/edycja` })])}`)}
    ${grupa('Dostępność', j.out_of_service ? 'wyłączona z najmu' : o.najem ? 'wynajęta' : 'wolna', o.najem
    ? '<p class="podpowiedz">Wynajętej jednostki nie można wyłączyć z najmu – najpierw zakończ najem.</p>'
    : menu([
      pozycja({ tekst: j.out_of_service ? 'Przywróć do najmu' : 'Wyłącz z najmu (np. remont)', akcja: 'wylacz', id: j.id }),
      !j.out_of_service ? pozycja({ tekst: '+ Wynajmij', href: `#/najmy/nowy?jednostka=${id}` }) : null,
    ]))}
    <h3 class="naglowek-grup">Bieżący najem</h3>
    ${o.najem ? grupaNajmu(s, o.najem, dzien, { tytul: esc(o.klient?.name ?? 'Klient') })
    + menu([o.klient ? pozycja({ tekst: 'Karta klienta', href: `#/klienci/${encodeURIComponent(o.klient.id)}` }) : null])
    : '<p class="wyciszony">Brak – jednostka jest wolna.</p>'}
    ${historia.filter((n) => n !== o.najem).length ? `<h3 class="naglowek-grup">Wcześniejsze najmy</h3>
      ${historia.filter((n) => n !== o.najem).map((n) => grupaNajmu(s, n, dzien, { tytul: esc(klientNajmu(n)?.name ?? '—') })).join('')}` : ''}`;
  return kartaUstawien(s, { id: 'j-ustawienia', tytul: `Ustawienia jednostki ${esc(j.code)}`, tresc, przyciskEdycji });
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
    anuluj: j ? `#/jednostki/${encodeURIComponent(j.id)}` : '#/ustawienia',
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
  /** Zapamiętuje rozwinięte grupy typów (lista jest renderowana od nowa przy każdej zmianie). */
  poRenderze(root, s) {
    if (s.ui.parametr) return;
    for (const d of root.querySelectorAll('details.grupa')) {
      d.addEventListener('toggle', () => {
        if (s.ui.szukaj.jednostki || (s.ui.filtry.jednostki ?? 'wszystkie') !== 'wszystkie') return;
        const zbior = s.ui.grupyJednostek ?? (s.ui.grupyJednostek = new Set());
        if (d.open) zbior.add(d.dataset.typ); else zbior.delete(d.dataset.typ);
      });
    }
  },

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
    if (parametr === 'nowa') return { href: '#/ustawienia', tekst: 'Ustawienia' };
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
    /** Cofnięcie wypowiedzenia z ustawień jednostki (jak na karcie klienta). */
    async 'cofnij-wypowiedzenie'(el, ctx) {
      if (ctx.state.podglad || ctx.state.offline || ctx.state.zKopii) {
        ctx.toast('Zmiana wymaga połączenia z bazą.');
        return;
      }
      try {
        ctx.scal({ rentals: [await ctx.db.zmien('rentals', el.dataset.id, { notice_given_on: null, notice_end_on: null })] });
        ctx.toast('Cofnięto wypowiedzenie. Zadanie na liście zostało – odhacz je albo usuń.');
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
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
