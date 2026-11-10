// Raporty (rozdz. 9): wybór okresu u góry i karty. Liczby z rozliczenia klientów i statystyki.js.
// Ryczałt i próg 100 000 zł – kolejna porcja kroku 1d.

import { TYPY_JEDNOSTEK } from '../config.js';
import { najemTrwa, pelneMiesiaceWplat } from '../dane.js';
import { filtry, pustyStan, wPlanie } from '../ui.js';
import { esc, dzisiaj, etykietaMiesiaca, formatData, formatZl, MIESIACE_KROTKO, porownajKody } from '../utils.js';
import { limityVat, przychodKasowy, przychodMiesiecznie, PROGI_VAT, wiekowanie, zakresOkresu } from '../statystyki.js';
import { rozliczeniaKlientow, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const MIN_PELNYCH_MIESIECY = 2;   // 9 i 12.3

const OKRESY = [
  { id: 'miesiac', tekst: 'Miesiąc' },
  { id: 'kwartal', tekst: 'Kwartał' },
  { id: 'rok', tekst: 'Rok' },
  { id: '12m', tekst: 'Ostatnie 12 miesięcy' },
];

const procent = (x) => `${Math.round(x * 100)}%`;
const pasek = (udzial, klasa = '') => `<div class="pasek-postepu ${klasa}" role="presentation">
  <span style="width:${Math.min(100, Math.max(0, udzial * 100)).toFixed(1)}%"></span></div>`;

/** Należności z terminem w zakresie i ich pokrycie (ściągalność, przychód na jednostkę). */
function naleznosciZakresu(s, od, doDnia) {
  const wynik = [];
  for (const r of rozliczeniaKlientow(s).values()) {
    for (const p of r.pozycje) if (!p.otwarcie && p.termin >= od && p.termin <= doDnia) wynik.push(p);
  }
  return wynik;
}

function kartaPrzychodu(s, z) {
  const dzis = dzisiaj();
  const doDnia = z.do < dzis ? z.do : dzis;
  const wplynelo = przychodKasowy(s.dane.payments, z.od, z.do);
  const naleznosci = naleznosciZakresu(s, z.od, doDnia);
  const nalezne = naleznosci.reduce((x, p) => x + p.kwotaGr, 0);
  const pokryte = naleznosci.reduce((x, p) => x + Math.min(p.zaplaconoGr, p.kwotaGr), 0);
  const miesiace = przychodMiesiecznie(s.dane.payments, z.od, z.do);
  const gotowka = miesiace.reduce((x, m) => x + m.gotowka, 0);
  const max = Math.max(1, ...miesiace.map((m) => m.wplynelo));
  const slupki = miesiace.length > 1 ? `<ul class="slupki" aria-label="Wpłynęło w kolejnych miesiącach">${miesiace.map((m) => `
    <li title="${esc(`${etykietaMiesiaca(m.klucz)}: ${formatZl(m.wplynelo)}`)}">
      <span class="slupek" style="height:${((m.wplynelo / max) * 100).toFixed(1)}%"></span>
      <span class="maly">${MIESIACE_KROTKO[Number(m.klucz.slice(5)) - 1]}</span>
      <span class="sr-only">${formatZl(m.wplynelo)}</span></li>`).join('')}</ul>` : '';
  return `<dl class="opis-pol">
      <dt>Wpłynęło</dt><dd class="kwota"><strong>${formatZl(wplynelo)}</strong></dd>
      <dt>w tym gotówka</dt><dd class="kwota">${formatZl(gotowka)}</dd>
      <dt>Należne${doDnia < z.do ? ' do dziś' : ''}</dt><dd class="kwota">${formatZl(nalezne)}</dd>
      <dt>Ściągalność</dt><dd>${nalezne ? procent(pokryte / nalezne) : '—'}</dd>
      ${miesiace.length > 1 ? `<dt>Średnio na miesiąc</dt><dd class="kwota">${formatZl(Math.round(wplynelo / Math.max(1,
    miesiace.filter((m) => m.klucz <= dzis.slice(0, 7)).length)))}</dd>` : ''}
    </dl>${slupki}`;
}

function kartaVat(s, rok) {
  const dzis = dzisiaj();
  const limity = limityVat(s.dane, { rok, dzis, limitGr: ustawienia(s).vat_limit_gr });
  return `${limity.map((l) => {
    const klasa = l.przekroczono || l.udzial >= PROGI_VAT[1] ? 'zalega' : l.udzial >= PROGI_VAT[0] ? 'czesciowo' : '';
    let opis = '';
    if (l.przekroczono) opis = `<span class="status zalega">Limit przekroczony ${formatData(l.dataPrzekroczenia)}</span>`;
    else if (l.prognoza) opis = `<span class="${klasa ? `status ${klasa}` : 'wyciszony'}">Prognoza przekroczenia: ${etykietaMiesiaca(l.prognoza)}</span>`;
    else opis = '<span class="wyciszony">W tym roku bez przekroczenia przy obecnym tempie</span>';
    return `<div class="limit">
      <p><strong>${esc(l.nazwa)}</strong><br><span class="kwota">${formatZl(l.sumaGr)}</span> z ${formatZl(l.limitGr, { grosze: false })} (${procent(l.udzial)})</p>
      ${pasek(l.udzial, klasa)}<p class="maly">${opis}</p></div>`;
  }).join('')}
    <p class="podpowiedz">Rok ${rok}, tylko przelewy (gotówka się nie liczy), czynsz i inne przychody bez kaucji.
      Wskaźnik orientacyjny – sposób liczenia limitu potwierdź z księgową.</p>`;
}

function kartaDluznikow(s) {
  const dzis = dzisiaj();
  const rozl = rozliczeniaKlientow(s);
  const dluznicy = [...rozl.entries()].filter(([, r]) => r.dluznik)
    .map(([id, r]) => ({ k: s.indeksy.klienci.get(id), r })).filter((x) => x.k && !x.k.archived)
    .sort((a, b) => b.r.zalegloscGr - a.r.zalegloscGr);
  if (!dluznicy.length) return '<p class="wyciszony">Nikt nie zalega.</p>';
  const w = wiekowanie(rozl, dzis);
  const suma = dluznicy.reduce((x, d) => x + d.r.zalegloscGr, 0);
  return `<p><strong>${dluznicy.length}</strong> dłużników · razem <span class="kwota">${formatZl(suma)}</span></p>
    <table class="tabela"><thead><tr><th scope="col">Po terminie</th><th scope="col" class="kwota">Kwota</th></tr></thead>
      <tbody>${w.map((x) => `<tr><td>${x.tekst}</td><td class="kwota">${formatZl(x.gr)}</td></tr>`).join('')}</tbody></table>
    <h3 class="maly">10 największych</h3>
    <ol class="ranking">${dluznicy.slice(0, 10).map(({ k, r }) => `<li><a href="#/klienci/${encodeURIComponent(k.id)}">${esc(k.name)}</a>
      <span class="kwota">${formatZl(r.zalegloscGr)}</span> <span class="wyciszony maly">${r.dniPoTerminie} dni</span></li>`).join('')}</ol>`;
}

function kartaOblozenia(s) {
  const dzis = dzisiaj();
  const jednostki = s.dane.units.filter((j) => !j.archived && !j.out_of_service);
  const wiersze = Object.entries(TYPY_JEDNOSTEK).map(([typ, t]) => {
    const wTypie = jednostki.filter((j) => j.type === typ);
    if (!wTypie.length) return '';
    const zajete = wTypie.filter((j) => (s.indeksy.najmyJednostki.get(j.id) ?? []).some((n) => najemTrwa(n, dzis))).length;
    return `<tr><td>${esc(t.mnoga)}</td><td>${zajete} / ${wTypie.length}</td><td>${procent(zajete / wTypie.length)}</td></tr>`;
  }).join('');
  return `<table class="tabela"><thead><tr><th scope="col">Typ</th><th scope="col">Zajęte</th><th scope="col">%</th></tr></thead>
    <tbody>${wiersze}</tbody></table>`;
}

function kartaJednostek(s, z) {
  const dzis = dzisiaj();
  const naleznosci = naleznosciZakresu(s, z.od, z.do < dzis ? z.do : dzis);
  const naJednostke = new Map();
  for (const p of naleznosci) naJednostke.set(p.jednostkaId, (naJednostke.get(p.jednostkaId) ?? 0) + Math.min(p.zaplaconoGr, p.kwotaGr));
  const suma = [...naJednostke.values()].reduce((x, v) => x + v, 0);
  if (!suma) return '<p class="wyciszony">Brak opłaconych należności w tym okresie.</p>';
  const top = [...naJednostke.entries()].map(([id, gr]) => ({ j: s.indeksy.jednostki.get(id), gr }))
    .filter((x) => x.j).sort((a, b) => b.gr - a.gr || porownajKody(a.j.code, b.j.code)).slice(0, 10);
  const typy = Object.entries(TYPY_JEDNOSTEK).map(([typ, t]) => {
    const gr = [...naJednostke.entries()].filter(([id]) => s.indeksy.jednostki.get(id)?.type === typ).reduce((x, [, v]) => x + v, 0);
    return gr ? `<tr><td>${esc(t.mnoga)}</td><td class="kwota">${formatZl(gr)}</td><td>${procent(gr / suma)}</td></tr>` : '';
  }).join('');
  return `<table class="tabela"><thead><tr><th scope="col">Typ</th><th scope="col" class="kwota">Opłacone</th><th scope="col">Udział</th></tr></thead>
      <tbody>${typy}</tbody></table>
    <h3 class="maly">10 jednostek z najwyższym przychodem</h3>
    <ol class="ranking">${top.map((x) => `<li><a class="mono" href="#/jednostki/${encodeURIComponent(x.j.id)}">${esc(x.j.code)}</a>
      <span class="kwota">${formatZl(x.gr)}</span></li>`).join('')}</ol>
    <p class="podpowiedz">Opłacone należności z terminem w okresie (wpłaty przypisane do najmów).</p>`;
}

export default {
  tytul: () => 'Raporty',

  render(s) {
    if (pelneMiesiaceWplat(s.dane.payments, dzisiaj()) < MIN_PELNYCH_MIESIECY) {
      return pustyStan('Raporty pojawią się po drugim pełnym miesiącu wpłat.');
    }
    const okres = s.ui.filtry.raporty ?? 'miesiac';
    const z = zakresOkresu(okres, s.ui.miesiac, dzisiaj());
    const rok = Number(okres === '12m' ? dzisiaj().slice(0, 4) : z.od.slice(0, 4));
    const karta = (id, tytul, tresc) => `<section class="karta" aria-labelledby="r-${id}"><h2 id="r-${id}">${tytul}</h2>${tresc}</section>`;
    return `
      ${filtry(OKRESY, okres, 'Okres raportu')}
      ${okres !== '12m' ? wyborMiesiaca(s) : ''}
      ${z.tytul ? `<p class="podpowiedz">${esc(z.tytul)}: ${formatData(z.od)} – ${formatData(z.do)}</p>` : ''}
      <div class="siatka">
        ${karta('przychod', 'Przychód', kartaPrzychodu(s, z))}
        ${karta('vat', `Limity zwolnienia z VAT ${rok}`, kartaVat(s, rok))}
        ${karta('dluznicy', 'Dłużnicy (stan na dziś)', kartaDluznikow(s))}
        ${karta('jednostki', 'Przychód według jednostek', kartaJednostek(s, z))}
        ${karta('oblozenie', 'Obłożenie (dziś)', kartaOblozenia(s))}
        ${karta('podatek', 'Ryczałt', wPlanie('Kwartały: przychód, narastająco, ryczałt, termin, wpłaty; próg 100 000 zł – kolejna porcja.'))}
      </div>`;
  },

  poRenderze(root, s) {
    if ((s.ui.filtry.raporty ?? 'miesiac') !== '12m') pokazWybranyMiesiac(root);
  },
};
