// Promocje i podwyżki (prośba 12.11.2026) – ekran pod zakładką Raporty: #/stawki
//  - Promocje: kto korzysta teraz, kto ma promocję zaplanowaną, kto skorzystał wcześniej (filtr po nazwie promocji);
//  - Podwyżki: klient, jednostka, od kiedy, stara → nowa stawka (filtr po roku);
//  - Zmiany kwot: ręczne zmiany kwoty w wybranym miesiącu (obniżki, umorzenia, dopłaty).
// Dane z historii stawek (rental_rates) i korekt (charge_adjustments) – js/promocje.js → zestawienieStawek.

import { doCsv } from '../csv.js';
import { zestawienieStawek } from '../promocje.js';
import { filtry, pobierzPlik, pustyStan } from '../ui.js';
import { dzisiaj, esc, formatData, formatZl } from '../utils.js';
import { nazwaMiesiaca } from './wspolne.js';

const ZAKLADKI = [
  { id: 'promocje', tekst: 'Promocje' },
  { id: 'podwyzki', tekst: 'Podwyżki' },
  { id: 'zmiany', tekst: 'Zmiany kwot w miesiącach' },
];

const STATUS = {
  trwa: { tekst: 'trwa', klasa: 'czesciowo' },
  zaplanowana: { tekst: 'zaplanowana', klasa: '' },
  zakonczona: { tekst: 'zakończona', klasa: '' },
  przerwana: { tekst: 'najem zakończony w trakcie', klasa: '' },
};

/** Pamięć zestawienia na dany stan danych (jak rozliczenia). */
let pamiec = { dane: null, dzien: null, wynik: null };
function zestawienie(s) {
  const dzien = dzisiaj();
  if (pamiec.dane !== s.dane || pamiec.dzien !== dzien) {
    pamiec = { dane: s.dane, dzien, wynik: zestawienieStawek(s.dane, s.indeksy, dzien) };
  }
  return pamiec.wynik;
}

const klientLink = (x) => (x.klient
  ? `<a href="#/klienci/${encodeURIComponent(x.klient.id)}">${esc(x.klient.name)}</a>${x.klient.archived ? ' <span class="wyciszony">(archiwum)</span>' : ''}`
  : '<span class="wyciszony">—</span>');
const kod = (x) => `<span class="mono">${esc(x.jednostka?.code ?? '?')}</span>`;
const zl = (gr) => (gr == null ? '—' : formatZl(gr, { grosze: false }));
const zlCsv = (gr) => (gr == null ? '' : (gr / 100).toFixed(2).replace('.', ','));

/** Chipy pomocnicze (nazwa promocji, rok) – osobna akcja, żeby nie mieszać z filtrem zakładek. */
const chipy = (opcje, aktywny, akcja, etykieta) => `<div class="filtry" role="group" aria-label="${esc(etykieta)}">${opcje.map((o) => `
  <button type="button" data-akcja="${akcja}" data-wartosc="${esc(o.id)}" aria-pressed="${o.id === aktywny}">${esc(o.tekst)}${
  o.liczba != null ? ` (${o.liczba})` : ''}</button>`).join('')}</div>`;

// ---------------------------------------------------------------------
// Promocje
// ---------------------------------------------------------------------

function wybranePromocje(s) {
  const { promocje } = zestawienie(s);
  const nazwa = s.ui.promoNazwa ?? '';
  return nazwa ? promocje.filter((p) => p.nazwa === nazwa) : promocje;
}

function wierszPromocji(p) {
  const st = STATUS[p.status];
  return `<li><div class="wiersz"><div class="glowna">
      <strong>${klientLink(p)} · ${kod(p)}</strong>
      <span>${formatData(p.od)} – ${p.do ? formatData(p.do) : 'do końca najmu'}${p.gratisDo ? ` · gratis do ${formatData(p.gratisDo)}` : ''}</span>
      <span class="zawijaj">${esc(p.nazwa)}${st.klasa ? ` · <span class="status ${st.klasa}">${st.tekst}</span>` : ` · ${st.tekst}`}</span></div>
    <div class="prawa kwota">${zl(p.promocyjnaGr)}<br><span class="wyciszony maly">potem ${zl(p.regularnaGr)}</span></div></div></li>`;
}

function widokPromocji(s) {
  const { promocje } = zestawienie(s);
  if (!promocje.length) return pustyStan('Żaden najem nie ma jeszcze promocji.');
  const nazwy = [...new Set(promocje.map((p) => p.nazwa))].sort((a, b) => a.localeCompare(b, 'pl'));
  const nazwa = nazwy.includes(s.ui.promoNazwa) ? s.ui.promoNazwa : '';
  const lista = nazwa ? promocje.filter((p) => p.nazwa === nazwa) : promocje;
  const trwaja = lista.filter((p) => p.status === 'trwa').sort((a, b) => String(a.do ?? '9').localeCompare(String(b.do ?? '9')));
  const zaplanowane = lista.filter((p) => p.status === 'zaplanowana').sort((a, b) => a.od.localeCompare(b.od));
  const wczesniej = lista.filter((p) => p.status === 'zakonczona' || p.status === 'przerwana')
    .sort((a, b) => String(b.do).localeCompare(String(a.do)));
  const sekcja = (tytul, wiersze, pusto) => `<section class="karta szeroka"><h2>${tytul} (${wiersze.length})</h2>
    ${wiersze.length ? `<ul class="lista">${wiersze.map(wierszPromocji).join('')}</ul>` : `<p class="wyciszony">${pusto}</p>`}</section>`;
  return `
    ${nazwy.length > 1 ? chipy([{ id: '', tekst: 'Wszystkie', liczba: promocje.length },
    ...nazwy.map((n) => ({ id: n, tekst: n, liczba: promocje.filter((p) => p.nazwa === n).length }))], nazwa, 'nazwa-promocji', 'Promocja') : ''}
    <div class="siatka">
      ${sekcja('Korzystają teraz', trwaja, 'Nikt teraz nie korzysta z promocji.')}
      ${zaplanowane.length ? sekcja('Zaplanowane', zaplanowane, '') : ''}
      ${sekcja('Skorzystali wcześniej', wczesniej, 'Brak zakończonych promocji.')}
    </div>`;
}

// ---------------------------------------------------------------------
// Podwyżki
// ---------------------------------------------------------------------

function widokPodwyzek(s) {
  const { podwyzki } = zestawienie(s);
  if (!podwyzki.length) return pustyStan('W historii stawek nie ma podwyżek.');
  const lata = [...new Set(podwyzki.map((p) => p.od.slice(0, 4)))].sort().reverse();
  const rok = lata.includes(s.ui.podwyzkiRok) ? s.ui.podwyzkiRok : '';
  const lista = rok ? podwyzki.filter((p) => p.od.startsWith(rok)) : podwyzki;
  const klienci = new Set(lista.map((p) => p.klient?.id)).size;
  const wiersze = lista.map((p) => {
    const roznica = p.naGr - p.zGr;
    const proc = p.zGr ? Math.round((roznica / p.zGr) * 1000) / 10 : null;
    return `<li><div class="wiersz"><div class="glowna">
        <strong>${klientLink(p)} · ${kod(p)}</strong>
        <span>od ${formatData(p.od)}${p.zaplanowana ? ' · <span class="status czesciowo">zaplanowana</span>' : ''}${p.powod ? ` · ${esc(p.powod)}` : ''}</span></div>
      <div class="prawa kwota">${zl(p.zGr)} → ${zl(p.naGr)}<br><span class="wyciszony maly">+${zl(roznica)}${
  proc != null ? ` (+${String(proc).replace('.', ',')}%)` : ''}</span></div></div></li>`;
  }).join('');
  return `
    ${lata.length > 1 ? chipy([{ id: '', tekst: 'Wszystkie', liczba: podwyzki.length },
    ...lata.map((y) => ({ id: y, tekst: y, liczba: podwyzki.filter((p) => p.od.startsWith(y)).length }))], rok, 'rok-podwyzek', 'Rok') : ''}
    <section class="karta szeroka"><h2>Podwyżki${rok ? ` w ${rok}` : ''}: ${lista.length} (klientów: ${klienci})</h2>
      <ul class="lista">${wiersze}</ul>
      <p class="podpowiedz">Podwyżka = stawka wyższa od poprzedniej normalnej stawki najmu. Powrót do normalnej stawki po promocji
        nie jest tu liczony – jest w zakładce Promocje.</p></section>`;
}

// ---------------------------------------------------------------------
// Ręczne zmiany kwot
// ---------------------------------------------------------------------

function widokZmian(s) {
  const { zmianyKwot } = zestawienie(s);
  if (!zmianyKwot.length) {
    return pustyStan('Nie ma ręcznych zmian kwot. Zmienisz kwotę w miesiącu na karcie klienta: przy najmie „Kwoty w miesiącach” → „zmień”.');
  }
  const wiersze = zmianyKwot.map((z) => `<li><a class="wiersz" href="#/najmy/${encodeURIComponent(z.najem.id)}/korekta?okres=${z.okres}">
      <div class="glowna"><strong>${esc(z.klient?.name ?? '—')} · ${kod(z)}</strong>
        <span>${esc(nazwaMiesiaca(z.okres))}${z.powod ? ` · ${esc(z.powod)}` : ''}</span></div>
      <div class="prawa kwota">${z.kwotaGr > 0 ? '+' : ''}${formatZl(z.kwotaGr)}</div></a></li>`).join('');
  return `<section class="karta szeroka"><h2>Zmiany kwot (${zmianyKwot.length})</h2><ul class="lista">${wiersze}</ul>
    <p class="podpowiedz">Kliknij wiersz, żeby poprawić albo cofnąć zmianę.</p></section>`;
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

function csv(s, zakladka) {
  const z = zestawienie(s);
  const dzis = dzisiaj();
  const wsp = (x) => [x.klient?.name ?? '', x.jednostka?.code ?? ''];
  if (zakladka === 'podwyzki') {
    return { nazwa: `podwyzki_${dzis}.csv`, tresc: doCsv(['klient', 'jednostka', 'od', 'stawka_przed_zl', 'stawka_po_zl', 'roznica_zl', 'powod'],
      z.podwyzki.map((p) => [...wsp(p), p.od, zlCsv(p.zGr), zlCsv(p.naGr), zlCsv(p.naGr - p.zGr), p.powod])) };
  }
  if (zakladka === 'zmiany') {
    return { nazwa: `zmiany_kwot_${dzis}.csv`, tresc: doCsv(['klient', 'jednostka', 'miesiac', 'zmiana_zl', 'powod'],
      z.zmianyKwot.map((x) => [...wsp(x), x.okres.slice(0, 7), zlCsv(x.kwotaGr), x.powod])) };
  }
  return { nazwa: `promocje_${dzis}.csv`, tresc: doCsv(['klient', 'jednostka', 'promocja', 'od', 'do', 'gratis_do', 'stawka_promocyjna_zl',
    'stawka_normalna_zl', 'status'], wybranePromocje(s).map((p) => [...wsp(p), p.nazwa, p.od, p.do ?? '', p.gratisDo ?? '',
    zlCsv(p.promocyjnaGr), zlCsv(p.regularnaGr), STATUS[p.status].tekst])) };
}

export default {
  zakladka: 'raporty',
  tytul: () => 'Promocje i podwyżki',
  wstecz: () => ({ href: '#/raporty', tekst: 'Raporty' }),

  render(s) {
    const z = zestawienie(s);
    const liczby = { promocje: z.promocje.length, podwyzki: z.podwyzki.length, zmiany: z.zmianyKwot.length };
    const zakladka = ZAKLADKI.some((x) => x.id === s.ui.filtry.stawki) ? s.ui.filtry.stawki : 'promocje';
    const tresc = { promocje: widokPromocji, podwyzki: widokPodwyzek, zmiany: widokZmian }[zakladka](s);
    return `
      ${filtry(ZAKLADKI.map((x) => ({ ...x, liczba: liczby[x.id] })), zakladka, 'Zestawienie')}
      ${tresc}
      ${liczby[zakladka] ? `<p><button type="button" class="link-btn" data-akcja="csv-stawek" data-zakladka="${zakladka}">Pobierz CSV</button></p>` : ''}`;
  },

  akcje: {
    'nazwa-promocji'(el, ctx) {
      ctx.state.ui.promoNazwa = el.dataset.wartosc;
      ctx.render();
    },
    'rok-podwyzek'(el, ctx) {
      ctx.state.ui.podwyzkiRok = el.dataset.wartosc;
      ctx.render();
    },
    'csv-stawek'(el, ctx) {
      const { nazwa, tresc } = csv(ctx.state, el.dataset.zakladka);
      pobierzPlik(nazwa, tresc);
    },
  },
};
