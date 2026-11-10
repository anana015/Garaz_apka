// Raporty (rozdz. 9): wybór okresu u góry i karty. Liczby z rozliczenia klientów, statystyki.js i podatek.js.
// Adresy: #/raporty, #/raporty/ryczalt/RRRR-K (wpłata ryczałtu za kwartał, 6.5).

import { TYPY_JEDNOSTEK } from '../config.js';
import { najemTrwa, pelneMiesiaceWplat } from '../dane.js';
import { doCsv } from '../csv.js';
import { formularz, maBledy, pole, stanFormularza, wartosciFormularza, zapisz } from '../formularz.js';
import {
  etykietaKwartalu, NAGLOWEK_CSV, progRoku, STATUSY_KWARTALU, wierszeCsv, zestawienieRoku,
} from '../podatek.js';
import { filtry, pobierzPlik, pustyStan } from '../ui.js';
import {
  esc, dzisiaj, etykietaMiesiaca, formatData, formatRachunek, formatZl, kwotaDoPola, MIESIACE_KROTKO, porownajKody,
} from '../utils.js';
import { limityVat, przychodKasowy, przychodMiesiecznie, PROGI_VAT, wiekowanie, zakresOkresu } from '../statystyki.js';
import { walidujWplateRyczaltu } from '../walidacja.js';
import { opisProgu, rozliczeniaKlientow, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

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

/** Ryczałt roku (6.2–6.5): tabela kwartałów z wpłatami, próg 100 000 zł, ryczałt roczny i eksport do PIT-28. */
function kartaRyczaltu(s, rok) {
  const u = ustawienia(s);
  const dzis = dzisiaj();
  const z = zestawienieRoku(s.dane, { rok, dzis, ustawienia: u });
  const wiersze = z.kwartaly.map((k) => {
    const st = STATUSY_KWARTALU[k.status];
    const link = k.status === 'przyszly' ? '' : `<a class="maly" href="#/raporty/ryczalt/${rok}-${k.q}">${k.wplata ? 'Popraw' : 'Wpisz wpłatę'}</a>`;
    return `<tr>
      <th scope="row">${etykietaKwartalu(k.q)}</th>
      <td class="kwota">${formatZl(k.przychodGr, { grosze: false })}</td>
      <td class="kwota">${formatZl(k.narastajacoGr, { grosze: false })}</td>
      <td class="kwota"><strong>${formatZl(k.ryczaltGr, { grosze: false })}</strong>${k.ujemny ? ' <span class="status zalega" title="Przewaga zwrotów – sprawdź z księgową">!</span>' : ''}</td>
      <td>${formatData(k.termin)}</td>
      <td class="kwota">${k.wplata ? `${formatZl(k.wplaconoGr, { grosze: false })}<br><span class="wyciszony maly">${formatData(k.wplata.paid_on)}</span>` : '—'}</td>
      <td><span class="status ${st.klasa}">${st.tekst}</span>${link ? `<br>${link}` : ''}</td></tr>`;
  }).join('');
  const ujemny = z.kwartaly.some((k) => k.ujemny);
  const p = progRoku(s.dane.payments, { rok, dzis: rok < Number(dzis.slice(0, 4)) ? `${rok}-12-31` : dzis, ustawienia: u });
  const roznica = z.roznicaGr;
  const rokZamkniety = dzis > `${rok}-12-31`;
  return `<div class="tabela-przewijana"><table class="tabela">
      <thead><tr><th scope="col">Kwartał</th><th scope="col" class="kwota">Przychód</th><th scope="col" class="kwota">Narastająco</th>
        <th scope="col" class="kwota">Ryczałt</th><th scope="col">Termin</th><th scope="col" class="kwota">Wpłacono</th>
        <th scope="col">Status</th></tr></thead>
      <tbody>${wiersze}</tbody>
      <tfoot><tr><th scope="row">Rok</th><td class="kwota">${formatZl(z.przychodGr, { grosze: false })}</td><td></td>
        <td class="kwota"><strong>${formatZl(z.ryczaltKwartalyGr, { grosze: false })}</strong></td><td></td>
        <td class="kwota">${formatZl(z.wplaconoGr, { grosze: false })}</td><td></td></tr></tfoot>
    </table></div>
    ${ujemny ? '<p class="baner ostrzezenie">W kwartale oznaczonym „!” zwroty przewyższyły przychód – pokazuję 0 zł. Sprawdź z księgową.</p>' : ''}
    <dl class="opis-pol">
      <dt>Ryczałt za rok (PIT-28)</dt><dd class="kwota">${formatZl(z.ryczaltRocznyGr, { grosze: false })}</dd>
      <dt>${roznica >= 0 ? (rokZamkniety ? 'Do dopłaty w zeznaniu' : 'Pozostało do wpłaty') : 'Nadpłata'}</dt>
      <dd class="kwota">${formatZl(Math.abs(roznica), { grosze: false })}</dd>
      <dt>Mikrorachunek</dt><dd>${u.tax_account ? `<span class="mono">${esc(formatRachunek(u.tax_account))}</span>`
    : '<a href="#/ustawienia">wpisz w Ustawieniach</a>'}</dd>
    </dl>
    ${opisProgu(p, u)}
    <details class="historia-stawek"><summary>Przychód miesięcznie</summary>
      <table class="tabela"><tbody>${z.miesiace.map((m) => `<tr><td>${esc(etykietaMiesiaca(m.klucz))}</td>
        <td class="kwota">${formatZl(m.przychodGr)}</td></tr>`).join('')}</tbody></table></details>
    <p><button type="button" class="przycisk drugi" data-akcja="csv-ryczaltu" data-rok="${rok}">Zestawienie do PIT-28 (CSV)</button></p>
    <p class="podpowiedz">Przychód kasowy: czynsz i inne przychody (przelewy, gotówka, zatrzymane kaucje), bez kaucji i wpłat pominiętych.
      Przychód kwartału i ryczałt zaokrąglone do pełnych złotych. Kwoty orientacyjne – nie zastępują księgowej.${
  u.tax_period === 'miesiac' ? ' W Ustawieniach wybrano wpłaty miesięczne – aplikacja liczy na razie kwartalnie.' : ''}</p>`;
}

/** Kwartał z adresu #/raporty/ryczalt/RRRR-K. */
function kwartalZAdresu(s) {
  const m = /^(\d{4})-([1-4])$/.exec(s.ui.akcja ?? '');
  return m ? { rok: Number(m[1]), q: Number(m[2]) } : null;
}

function formularzRyczaltu(s) {
  const kw = kwartalZAdresu(s);
  if (!kw) return pustyStan('Nie ma takiego kwartału.', [{ tekst: 'Wróć do raportów', href: '#/raporty' }]);
  const u = ustawienia(s);
  const k = zestawienieRoku(s.dane, { rok: kw.rok, dzis: dzisiaj(), ustawienia: u }).kwartaly[kw.q - 1];
  const f = stanFormularza(s, `raporty/ryczalt/${s.ui.akcja}`, () => (k.wplata
    ? { paid_on: k.wplata.paid_on, amount_gr: kwotaDoPola(k.wplata.amount_gr) }
    : { paid_on: dzisiaj(), amount_gr: kwotaDoPola(k.ryczaltGr) }));
  const szczegoly = `<section class="karta"><dl class="opis-pol">
    <dt>Kwartał</dt><dd><strong>${etykietaKwartalu(kw.q)} ${kw.rok}</strong> (${formatData(k.od)} – ${formatData(k.do)})</dd>
    <dt>Przychód</dt><dd class="kwota">${formatZl(k.przychodGr, { grosze: false })}</dd>
    <dt>Narastająco</dt><dd class="kwota">${formatZl(k.narastajacoGr, { grosze: false })}</dd>
    <dt>Ryczałt wyliczony</dt><dd class="kwota"><strong>${formatZl(k.ryczaltGr, { grosze: false })}</strong></dd>
    <dt>Termin</dt><dd>${formatData(k.termin)}</dd>
    <dt>Mikrorachunek</dt><dd>${u.tax_account ? `<span class="mono">${esc(formatRachunek(u.tax_account))}</span>` : 'nie podano w Ustawieniach'}</dd>
  </dl></section>`;
  return `${szczegoly}${formularz(f, {
    nazwa: 'ryczalt',
    przycisk: k.wplata ? 'Zapisz zmiany' : 'Zapisz wpłatę',
    anuluj: '#/raporty',
    tresc: `<div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'amount_gr', etykieta: 'Wpłacona kwota (zł)', typ: 'kwota', wymagane: true,
    podpowiedz: 'Podpowiedź: ryczałt wyliczony przez aplikację. Wpisz kwotę z potwierdzenia przelewu.' })}
        ${pole(f, { nazwa: 'paid_on', etykieta: 'Data wpłaty', typ: 'date', wymagane: true, atrybuty: `max="${dzisiaj()}"` })}
      </div>
      ${k.wplata ? '<p><button type="button" class="link-btn" data-akcja="usun-ryczalt">Usuń tę wpłatę</button></p>' : ''}`,
  })}`;
}

export default {
  tytul: (s) => (s.ui.parametr === 'ryczalt' ? 'Wpłata ryczałtu' : 'Raporty'),

  wstecz: (s) => (s.ui.parametr ? { href: '#/raporty', tekst: 'Raporty' } : null),

  render(s) {
    if (s.ui.parametr === 'ryczalt') return formularzRyczaltu(s);
    if (pelneMiesiaceWplat(s.dane.payments, dzisiaj()) < MIN_PELNYCH_MIESIECY) {
      return pustyStan('Raporty pojawią się po drugim pełnym miesiącu wpłat.');
    }
    const okres = s.ui.filtry.raporty ?? 'miesiac';
    const z = zakresOkresu(okres, s.ui.miesiac, dzisiaj());
    const rok = Number(okres === '12m' ? dzisiaj().slice(0, 4) : z.od.slice(0, 4));
    const karta = (id, tytul, tresc, klasa = '') => `<section class="karta${klasa ? ` ${klasa}` : ''}" aria-labelledby="r-${id}">
      <h2 id="r-${id}">${tytul}</h2>${tresc}</section>`;
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
        ${karta('podatek', `Ryczałt ${rok}`, kartaRyczaltu(s, rok), 'szeroka')}
      </div>`;
  },

  poRenderze(root, s) {
    if (!s.ui.parametr && (s.ui.filtry.raporty ?? 'miesiac') !== '12m') pokazWybranyMiesiac(root);
  },

  akcje: {
    'csv-ryczaltu'(el, ctx) {
      const rok = Number(el.dataset.rok);
      const z = zestawienieRoku(ctx.state.dane, { rok, dzis: dzisiaj(), ustawienia: ustawienia(ctx.state) });
      pobierzPlik(`ryczalt_${rok}.csv`, doCsv([...NAGLOWEK_CSV], wierszeCsv(z)));
    },
    async 'usun-ryczalt'(el, ctx) {
      const s = ctx.state;
      const kw = kwartalZAdresu(s);
      const wplata = kw && s.dane.tax_payments.find((t) => t.year === kw.rok && t.quarter === kw.q);
      if (!wplata) return;
      if (s.podglad || s.offline) {
        ctx.toast('Usuwanie wymaga połączenia z bazą.');
        return;
      }
      try {
        await ctx.db.usun('tax_payments', wplata.id);
        s.dane = { ...s.dane, tax_payments: s.dane.tax_payments.filter((t) => t.id !== wplata.id) };
        ctx.toast(`Usunięto wpłatę ryczałtu za ${etykietaKwartalu(kw.q)} ${kw.rok}`);
        ctx.nawiguj('raporty');
      } catch (e) {
        ctx.toast(e.message);
      }
    },
  },

  formularze: {
    async ryczalt(form, ctx) {
      const s = ctx.state;
      const kw = kwartalZAdresu(s);
      if (!kw) return;
      const w = wartosciFormularza(form);
      const { bledy, wiersz } = walidujWplateRyczaltu(w, { ...kw, dzis: dzisiaj() });
      if (maBledy(ctx, w, bledy)) return;
      const istniejaca = s.dane.tax_payments.find((t) => t.year === kw.rok && t.quarter === kw.q);
      await zapisz(ctx, async () => {
        const zapisana = istniejaca ? await ctx.db.zmien('tax_payments', istniejaca.id, wiersz)
          : await ctx.db.wstaw('tax_payments', wiersz);
        ctx.scal({ tax_payments: [zapisana] });
        ctx.toast(`Zapisano wpłatę ryczałtu ${formatZl(zapisana.amount_gr, { grosze: false })} za ${etykietaKwartalu(kw.q)} ${kw.rok}`);
        ctx.nawiguj('raporty');
      });
    },
  },
};
