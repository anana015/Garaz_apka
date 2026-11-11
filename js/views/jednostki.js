// Jednostki (8.7): kafelki pogrupowane według typu albo mapa placu (js/mapa.js), szczegóły jednostki i formularz jednostki (8.6).
// Adresy: #/jednostki, #/jednostki/nowa, #/jednostki/<id>, #/jednostki/<id>/edycja

import { TYPY_JEDNOSTEK } from '../config.js';
import { biezacyNajem, opisPlatnosci, planowanyKoniec, stawkaNaDzien } from '../dane.js';
import { formularz, maBledy, obszar, pole, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, przyciskEdycji } from '../ui.js';
import { promocjaNajmu } from '../promocje.js';
import { ALEJKI, GORA, LINIA_WJAZDU, MIEJSCA, SZEROKOSC, WYLACZONE_MIEJSCA, WYSOKOSC, miejsceJednostki, rozmiescJednostki } from '../mapa.js';
import { grupa, grupaNajmu, kartaUstawien, menu, pozycja } from './edycja.js';
import { akcjeAnulowania } from './edycja.js';
import {
  esc, dzisiaj, etykietaMiesiaca, formatData, formatDataKrotka, formatM2, formatZl, kluczMiesiaca, kwotaDoPola,
  MIESIACE_KROTKO, nastepnyNumer, normalizujTekst, porownajKody, roznicaDni, zakresMiesiecy, dodajMiesiace,
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
  const wypowiedzenie = najem ? planowanyKoniec(najem, dzien) : null;
  // Następny najem (jednostka przejęta albo wynajęta od przyszłej daty).
  const nastepny = (s.indeksy.najmyJednostki.get(j.id) ?? []).filter((n) => n.start_on > dzien)
    .sort((a, b) => a.start_on.localeCompare(b.start_on))[0] ?? null;
  const nastepnyKlient = nastepny && s.indeksy.klienci.get(s.indeksy.umowy.get(nastepny.contract_id)?.client_id);
  return { j, najem, umowa, klient, status, stawka, zalegloscGr, oplaconeDo, promo, wypowiedzenie, nastepny, nastepnyKlient };
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
  wypowiedziane: { tekst: 'Kończące się najmy', warunek: (o) => Boolean(o.wypowiedzenie) },
  promocje: { tekst: 'W promocji', warunek: (o) => Boolean(o.promo) },
};

/** Tekst statusu jak na kafelku: „zalega 200 zł”, „opłacona do 20.11”, „Wolna”. */
function tekstStatusu(o) {
  if (o.status === 'zalega') return `zalega ${formatZl(o.zalegloscGr, { grosze: false })}`;
  if (o.status === 'oplacona' && o.oplaconeDo) return `opłacona do ${formatDataKrotka(o.oplaconeDo)}`;
  return STATUS[o.status].tekst;
}

function kafelek(o, s) {
  const st = STATUS[o.status];
  const umowa = koniecUmowy(o.umowa, o.najem, s);
  return `<a class="jednostka ${st.klasa}" href="#/jednostki/${encodeURIComponent(o.j.id)}">
    <strong>${esc(o.j.code)}</strong>
    <span class="status ${st.klasa}">${tekstStatusu(o)}</span>
    <span>${[formatM2(o.j.area_m2), o.stawka != null ? formatZl(o.stawka, { grosze: false }) : ''].filter(Boolean).join(' · ')}</span>
    ${o.klient ? `<span>${esc(o.klient.name)}</span>` : ''}
    ${o.wypowiedzenie ? `<span class="znacznik${o.wypowiedzenie < dzisiaj() ? ' pilne' : ''}">${o.najem.notice_end_on ? 'wypowiedziana' : 'najem'} do ${formatDataKrotka(o.wypowiedzenie)}</span>` : ''}
    ${o.nastepny ? `<span class="znacznik promocja">od ${formatDataKrotka(o.nastepny.start_on)}: ${esc(o.nastepnyKlient?.name ?? 'nowy najem')}</span>` : ''}
    ${o.promo ? `<span class="znacznik promocja">${o.promo.do ? `promocja do ${formatDataKrotka(o.promo.do)}` : 'promocja'}</span>` : ''}
    ${umowa ? `<span class="znacznik${umowa.wygasla ? ' pilne' : ''}">${esc(umowa.tekst)}</span>` : ''}
  </a>`;
}

// ---------------------------------------------------------------------
// Mapa placu (js/mapa.js): kolor miejsca = status jednostki, klik = szczegóły jednostki.
// ---------------------------------------------------------------------

const KLUCZ_WIDOKU = 'najem.widokJednostek';

/** 'lista' albo 'mapa' – zapamiętane na urządzeniu (wygoda jednej osoby, bez bazy). */
function widokJednostek(s) {
  if (!s.ui.widokJednostek) {
    try { s.ui.widokJednostek = localStorage.getItem(KLUCZ_WIDOKU) === 'mapa' ? 'mapa' : 'lista'; } catch { s.ui.widokJednostek = 'lista'; }
  }
  return s.ui.widokJednostek;
}

function przelacznikWidoku(widok) {
  const b = (id, tekst) => `<button type="button" data-akcja="widok-jednostek" data-wartosc="${id}" aria-pressed="${widok === id}">${tekst}</button>`;
  return `<div class="przelacznik-widoku" role="group" aria-label="Widok jednostek">${b('lista', 'Lista')}${b('mapa', 'Mapa')}</div>`;
}

/**
 * Statusy na mapie (prośba 11.11) – prostsze niż na kafelkach: bez podziału na opłacone i zaległe.
 * Kolejność ważności: wyłączona → w trakcie wypowiedzenia → zajęta → wolna.
 */
const STATUS_MAPY = {
  wolna: 'Wolna',
  zajeta: 'Zajęta',
  wypowiedzenie: 'W trakcie wypowiedzenia',
  wylaczona: 'Wyłączona',
  brak: 'Brak w aplikacji',
};

function statusNaMapie(o) {
  if (o.status === 'wylaczona') return 'wylaczona';
  if (o.najem && o.wypowiedzenie) return 'wypowiedzenie';
  return o.najem ? 'zajeta' : 'wolna';
}

/**
 * Plan placu w SVG. Miejsca bez jednostki w aplikacji – przerywana ramka.
 * Przy filtrze albo wyszukiwaniu miejsca spoza wyniku są przygaszone.
 */
function mapa(s, opisy, widoczne, zawezone) {
  const { naMapie, pozaMapa, duplikaty } = rozmiescJednostki(s.dane.units);
  const poId = new Map(opisy.map((o) => [o.j.id, o]));
  const wynik = new Set(widoczne.map((o) => o.j.id));
  let brakow = 0;

  const komorki = MIEJSCA.map((m) => {
    const napis = `<text x="${m.x + m.w / 2}" y="${m.y + m.h / 2}">${esc(m.etykieta)}</text>`;
    const ksztalt = `<rect x="${m.x + 1}" y="${m.y + 1}" width="${m.w - 2}" height="${m.h - 2}" rx="2"/>`;
    const j = naMapie.get(m.klucz);
    const o = j && poId.get(j.id);
    if (!o && WYLACZONE_MIEJSCA.has(m.klucz)) {
      return `<g class="m-miejsce wylaczona${zawezone ? ' przygaszone' : ''}"><title>${esc(m.opis)} – wyłączona (jeszcze nie ma jej w aplikacji)</title>${ksztalt}${napis}</g>`;
    }
    if (!o) {
      brakow += 1;
      return `<g class="m-miejsce brak${zawezone ? ' przygaszone' : ''}"><title>${esc(m.opis)} – nie ma takiej jednostki w aplikacji</title>${ksztalt}${napis}</g>`;
    }
    const st = statusNaMapie(o);
    const opis = [o.j.code, STATUS_MAPY[st], o.klient?.name,
      st === 'wypowiedzenie' ? `koniec najmu ${formatDataKrotka(o.wypowiedzenie)}` : '']
      .filter(Boolean).join(' · ');
    const klasy = ['m-miejsce', st, zawezone && !wynik.has(o.j.id) ? 'przygaszone' : ''].filter(Boolean).join(' ');
    return `<a class="${klasy}" href="#/jednostki/${encodeURIComponent(o.j.id)}" aria-label="${esc(opis)}"><title>${esc(opis)}</title>${ksztalt}${napis}</a>`;
  }).join('');

  const alejki = ALEJKI.map((a) => `<text class="m-alejka" x="${a.x}" y="${LINIA_WJAZDU - 8}">R${a.rzad}</text>`).join('');
  const droga = `<rect class="m-droga" x="10" y="${LINIA_WJAZDU + 10}" width="${SZEROKOSC - 20}" height="22" rx="4"/>
    <text class="m-opis" x="${SZEROKOSC / 2}" y="${LINIA_WJAZDU + 21}">Droga dojazdowa · wjazd do alejek od południa</text>`;

  const legenda = Object.entries(STATUS_MAPY)
    .map(([k, t]) => `<li><span class="m-probka ${k}" aria-hidden="true"></span>${t}</li>`).join('');

  const nieumieszczone = [...pozaMapa, ...duplikaty].sort((a, b) => porownajKody(a.code, b.code));
  const poza = nieumieszczone.length ? `<details class="m-poza"><summary>Poza mapą: ${nieumieszczone.length}</summary>
      <p class="wyciszony maly">Kod garażu i kontenera powinien mieć postać G05R1 / K05R1 (numer i rząd), boxu – B01XS (mały) albo B02XL (duży).
      ${duplikaty.length ? 'Część jednostek wskazuje to samo miejsce co inna.' : ''}</p>
      <p>${nieumieszczone.map((j) => `<a class="mono" href="#/jednostki/${encodeURIComponent(j.id)}">${esc(j.code)}</a>`).join(', ')}</p></details>` : '';

  return `<figure class="mapa">
      <div class="mapa-przewijana">
        <svg viewBox="0 ${GORA} ${SZEROKOSC} ${WYSOKOSC - GORA}" role="group" aria-label="Plan placu: rzędy R1–R4 i boxy">${droga}${alejki}${komorki}</svg>
      </div>
      <figcaption>
        <ul class="m-legenda">${legenda}</ul>
        <p class="wyciszony maly">Numery rosną od wjazdu<span class="m-przewin"> · na telefonie przesuń plan w bok</span>. Boxy: XL = duży (4 m²), XS = mały (3 m²).
          Na mapie ${naMapie.size} z ${naMapie.size + nieumieszczone.length} jednostek${brakow ? ` · ${brakow} miejsc bez jednostki w aplikacji` : ''}.</p>
      </figcaption>
    </figure>${poza}`;
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
  const widok = widokJednostek(s);
  let tresc;
  if (widok === 'mapa') {
    tresc = mapa(s, opisy, widoczne, Boolean(szukane) || filtr !== 'wszystkie');
  } else if (!widoczne.length) {
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
    ${przelacznikWidoku(widok)}
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
          <dt>Na mapie</dt><dd>${esc(MIEJSCA.find((m) => m.klucz === miejsceJednostki(j))?.opis ?? 'poza mapą (kod nie pasuje do układu)')}</dd>
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
          ${o.wypowiedzenie && !o.najem.notice_end_on ? `<dt>Najem do</dt><dd>${formatData(o.wypowiedzenie)}</dd>` : ''}
          ${o.nastepny ? `<dt>Następny najem</dt><dd>od ${formatData(o.nastepny.start_on)} – ${o.nastepnyKlient
    ? `<a href="#/klienci/${encodeURIComponent(o.nastepnyKlient.id)}">${esc(o.nastepnyKlient.name)}</a>` : '?'}</dd>` : ''}
          ${o.wypowiedzenie && o.najem.notice_end_on ? `<dt>Wypowiedziana</dt><dd>${o.najem.notice_given_on ? `złożona ${formatData(o.najem.notice_given_on)} · ` : ''}koniec najmu
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
    <section class="karta" aria-labelledby="j-przychod"><h2 id="j-przychod">Przychód z jednostki – 12 miesięcy</h2>
      ${przychodJednostki(s, j, dzien)}</section>`;
}

/**
 * Przychód z jednostki za ostatnie 12 miesięcy (8.7): opłacone części należności jej najmów, według miesiąca terminu
 * (jak „Przychód według jednostek” w Raportach). Słupki + suma i średnia.
 */
function przychodJednostki(s, j, dzien) {
  const najmy = new Set((s.indeksy.najmyJednostki.get(j.id) ?? []).map((n) => n.id));
  const miesiace = zakresMiesiecy(kluczMiesiaca(dodajMiesiace(dzien, -11)), kluczMiesiaca(dzien));
  const mapa = new Map(miesiace.map((k) => [k, 0]));
  for (const r of rozliczeniaKlientow(s).values()) {
    for (const p of r.pozycje) {
      if (p.otwarcie || !najmy.has(p.najemId) || p.termin > dzien) continue;
      const k = kluczMiesiaca(p.termin);
      if (mapa.has(k)) mapa.set(k, mapa.get(k) + Math.min(p.zaplaconoGr, p.kwotaGr));
    }
  }
  const suma = [...mapa.values()].reduce((x, v) => x + v, 0);
  if (!suma) return '<p class="wyciszony">Brak opłaconych należności w ostatnich 12 miesiącach.</p>';
  const max = Math.max(1, ...mapa.values());
  return `<dl class="opis-pol">
      <dt>Razem</dt><dd class="kwota"><strong>${formatZl(suma)}</strong></dd>
      <dt>Średnio na miesiąc</dt><dd class="kwota">${formatZl(Math.round(suma / 12))}</dd>
    </dl>
    <ul class="slupki" aria-label="Przychód w kolejnych miesiącach">${miesiace.map((k) => `
      <li title="${esc(`${etykietaMiesiaca(k)}: ${formatZl(mapa.get(k))}`)}">
        <span class="slupek" style="height:${((mapa.get(k) / max) * 100).toFixed(1)}%"></span>
        <span class="maly">${MIESIACE_KROTKO[Number(k.slice(5)) - 1]}</span>
        <span class="sr-only">${formatZl(mapa.get(k))}</span></li>`).join('')}</ul>
    <p class="podpowiedz">Opłacone należności z terminem w danym miesiącu (wpłaty przypisane do najmów tej jednostki).</p>`;
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
    ...akcjeAnulowania,
    /** Przełącznik „Lista / Mapa” na ekranie Jednostki. */
    'widok-jednostek'(el, ctx) {
      const widok = el.dataset.wartosc === 'mapa' ? 'mapa' : 'lista';
      ctx.state.ui.widokJednostek = widok;
      try { localStorage.setItem(KLUCZ_WIDOKU, widok); } catch { /* tryb prywatny – zostaje do odświeżenia */ }
      ctx.render();
      document.querySelector(`[data-akcja="widok-jednostek"][data-wartosc="${widok}"]`)?.focus();
    },
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
