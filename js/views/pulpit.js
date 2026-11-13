// Pulpit (8.1): „Jak wygląda wybrany miesiąc i kto zalega?”
// Liczby z rozliczenia klientów (rozliczenia.js): należne, wpłynęło, brakuje (5.6), zaległości (5.4), obłożenie.

import { TYPY_JEDNOSTEK } from '../config.js';
import { najemTrwa, planowanyKoniec } from '../dane.js';
import { nazwaKategorii, zyskZakresu } from '../koszty.js';
import { daneGrupy, datyKwartalu, etykietaKwartalu, GRUPY_RYCZALTU, kwartalDaty, progRoku, zestawienieRoku } from '../podatek.js';
import { pustyStan } from '../ui.js';
import { esc, dzisiaj, etykietaMiesiaca, formatZl, formatData, kluczMiesiaca, MIESIACE_W, odmiana, porownajKody, roznicaDni } from '../utils.js';
import { opisProgu, rozliczeniaKlientow, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const LICZBA_DLUZNIKOW = 5;

function kafelek(etykieta, wartosc, opis, klasa = '') {
  return `<div class="kafelek${klasa ? ` ${klasa}` : ''}"><span class="etykieta">${etykieta}</span>
    <span class="wartosc">${wartosc}</span><span class="opis">${opis}</span></div>`;
}

const dni = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

/** Liczby miesiąca M i listy dla pulpitu. */
function policz(s) {
  const dzis = dzisiaj();
  const m = s.ui.miesiac;
  const rozl = rozliczeniaKlientow(s);
  const kod = (n) => s.indeksy.jednostki.get(n.jednostkaId)?.code ?? '';

  let naleznoGr = 0;
  const najmyMiesiaca = new Set();
  const brakujace = [];
  let zaleglosciGr = 0;
  const dluznicy = [];
  for (const [klientId, r] of rozl) {
    const klient = s.indeksy.klienci.get(klientId);
    const wMiesiacu = r.pozycje.filter((p) => !p.otwarcie && kluczMiesiaca(p.termin) === m);
    for (const p of wMiesiacu) { naleznoGr += p.kwotaGr; najmyMiesiaca.add(p.najemId); }
    const niezaplacone = wMiesiacu.filter((p) => p.zaplaconoGr < p.kwotaGr);
    if (niezaplacone.length) {
      brakujace.push({
        klient,
        kwotaGr: niezaplacone.reduce((x, p) => x + p.kwotaGr - p.zaplaconoGr, 0),
        termin: niezaplacone[0].termin,
        kody: [...new Set(niezaplacone.map(kod))].sort(porownajKody),
      });
    }
    zaleglosciGr += r.zalegloscGr;
    if (r.dluznik && !klient?.archived) dluznicy.push({ klient, r });
  }
  brakujace.sort((a, b) => a.termin.localeCompare(b.termin) || b.kwotaGr - a.kwotaGr);
  dluznicy.sort((a, b) => b.r.zalegloscGr - a.r.zalegloscGr);

  const wplynelo = s.dane.payments
    .filter((w) => ['czynsz', 'przychod_inny'].includes(w.kind) && kluczMiesiaca(w.booked_on) === m)
    .reduce((x, w) => x + w.amount_gr, 0);

  return { dzis, naleznoGr, najmyMiesiaca: najmyMiesiaca.size, brakujace, zaleglosciGr, dluznicy, wplynelo };
}

function listaBrakujacych(b, dzis) {
  if (!b.length) return '<p class="wyciszony">Wszystko wpłynęło.</p>';
  return `<ul class="lista">${b.map((x) => {
    const roznica = roznicaDni(x.termin, dzis);
    const stan = roznica > 0 ? `<span class="status zalega">${dni(roznica)} po terminie</span>`
      : roznica === 0 ? '<span class="status czesciowo">termin dziś</span>'
        : `<span class="wyciszony">termin za ${dni(-roznica)}</span>`;
    return `<li><a class="wiersz" href="#/klienci/${encodeURIComponent(x.klient?.id ?? '')}">
      <div class="glowna"><strong>${esc(x.klient?.name ?? '?')}</strong>
        <span>${x.kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('')} termin ${formatData(x.termin)}</span></div>
      <div class="prawa"><div class="kwota">${formatZl(x.kwotaGr)}</div><div class="maly">${stan}</div></div>
    </a></li>`;
  }).join('')}</ul>`;
}

/** Ostatnia obietnica zapłaty klienta, a gdy jej brak – ostatnia notatka (8.1, karta 8). */
function ostatniaNotatka(notatki, klientId, dzis) {
  const jego = notatki.filter((n) => n.client_id === klientId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const obietnica = jego.find((n) => n.kind === 'obietnica' && n.promised_on && !n.done_at);
  if (obietnica) {
    return `<span class="status ${obietnica.promised_on < dzis ? 'zalega' : 'czesciowo'}">obiecał${
      obietnica.promised_gr ? ` ${formatZl(obietnica.promised_gr)}` : ''} do ${formatData(obietnica.promised_on)}</span>`;
  }
  return jego[0] ? esc(jego[0].body.length > 60 ? `${jego[0].body.slice(0, 60)}…` : jego[0].body) : '';
}

function listaDluznikow(d, s, dzis) {
  if (!d.length) return '<p class="wyciszony">Nikt nie zalega.</p>';
  const wiecej = d.length > LICZBA_DLUZNIKOW
    ? `<p><button type="button" class="link-btn" data-akcja="idz" data-ekran="klienci" data-filtr="dluznicy">Wszyscy dłużnicy (${d.length}) ›</button></p>` : '';
  return `<ul class="lista">${d.slice(0, LICZBA_DLUZNIKOW).map(({ klient, r }) => {
    const notatka = ostatniaNotatka(s.dane.client_notes, klient.id, dzis);
    return `<li>
    <a class="wiersz" href="#/klienci/${encodeURIComponent(klient.id)}">
      <div class="glowna"><strong>${esc(klient.name)}</strong>
        <span>${notatka || `ostatnia wpłata: ${r.ostatniaWplata ? formatData(r.ostatniaWplata) : 'brak'}`}</span></div>
      <div class="prawa"><div class="kwota">${formatZl(-r.zalegloscGr)}</div>
        <div class="maly"><span class="status zalega">${dni(r.dniPoTerminie)} po terminie</span></div></div>
    </a></li>`;
  }).join('')}</ul>${wiecej}`;
}

function oblozenie(s, dzis) {
  const jednostki = s.dane.units.filter((j) => !j.archived && !j.out_of_service);
  if (!jednostki.length) return '<p class="wyciszony">Brak jednostek.</p>';
  const zajeta = (j) => (s.indeksy.najmyJednostki.get(j.id) ?? []).some((n) => najemTrwa(n, dzis));
  const zajete = jednostki.filter(zajeta).length;
  const procent = Math.round((zajete / jednostki.length) * 100);
  const wolneTypy = Object.entries(TYPY_JEDNOSTEK).map(([typ, t]) => {
    const wolne = jednostki.filter((j) => j.type === typ && !zajeta(j));
    return wolne.length ? `<dt>${esc(t.mnoga)}</dt><dd>${odmiana(wolne.length, ['wolna', 'wolne', 'wolnych'])}: ${
      wolne.map((j) => j.code).sort(porownajKody).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</dd>` : '';
  }).join('');
  return `<p><strong>${zajete} z ${jednostki.length}</strong> jednostek zajętych (${procent}%)</p>
    ${wolneTypy ? `<dl class="opis-pol">${wolneTypy}</dl>
      <p><button type="button" class="link-btn" data-akcja="idz" data-ekran="jednostki" data-filtr="wolne">Pokaż wolne ›</button></p>`
    : '<p class="wyciszony">Wszystkie jednostki są wynajęte.</p>'}`;
}

/** Karta „Kończące się najmy”: trwające najmy z wypowiedzeniem, od najbliższego końca. Po dacie – „zakończ najem”. */
function konczaceNajmy(s, dzis) {
  // Wypowiedziane i z zaplanowaną datą końca (np. jednostka przejęta przez nowego najemcę) – oraz po terminie bez „Zakończ najem”.
  const koniecNajmu = (n) => (n.end_on ? null : n.notice_end_on) ?? planowanyKoniec(n, dzis);
  const najmy = s.dane.rentals.filter((n) => koniecNajmu(n))
    .map((n) => ({ ...n, notice_end_on: koniecNajmu(n) }))
    .sort((a, b) => a.notice_end_on.localeCompare(b.notice_end_on));
  if (!najmy.length) return '<p class="wyciszony">Brak wypowiedzianych ani kończących się najmów.</p>';
  return `<ul class="lista">${najmy.map((n) => {
    const klient = s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);
    const kod = s.indeksy.jednostki.get(n.unit_id)?.code ?? '?';
    const minelo = n.notice_end_on < dzis;
    const za = roznicaDni(dzis, n.notice_end_on);
    return `<li><a class="wiersz" href="#/kreator/koniec/${encodeURIComponent(n.id)}">
      <div class="glowna"><strong><span class="mono">${esc(kod)}</span> · ${esc(klient?.name ?? '—')}</strong>
        <span>koniec najmu ${formatData(n.notice_end_on)}</span></div>
      <div class="prawa"><span class="status ${minelo ? 'zalega' : za <= 14 ? 'czesciowo' : 'zajeta'}">${minelo
    ? 'zakończ najem' : za === 0 ? 'dziś' : `za ${dni(za)}`}</span></div></a></li>`;
  }).join('')}</ul>`;
}

/**
 * Karta „Zysk” (etap 2): wybrany miesiąc i rok narastająco do końca tego miesiąca (albo do dziś).
 * Zysk = przychód kasowy − koszty − ryczałt szacunkowy (koszty.zyskZakresu).
 */
function kartaZysku(s, dzis) {
  const u = ustawienia(s);
  const m = s.ui.miesiac;
  const [y, mm] = m.split('-').map(Number);
  const koniec = `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  const doDnia = koniec < dzis ? koniec : dzis;
  const miesiac = zyskZakresu(s.dane, { od: `${m}-01`, do: doDnia, ustawienia: u });
  const rok = zyskZakresu(s.dane, { od: `${y}-01-01`, do: doDnia, ustawienia: u });
  const zl = (gr) => formatZl(gr, { grosze: false });
  const kwotaZysku = (gr) => (gr < 0 ? `<span class="status zalega">${zl(gr)}</span>` : zl(gr));
  const kategorie = miesiac.wgKategorii.length
    ? `<p class="maly wyciszony">Koszty w miesiącu: ${miesiac.wgKategorii.map((k) => `${esc(nazwaKategorii(k.kategoria))} ${zl(k.gr)}`).join(' · ')}</p>`
    : '';
  return `<div class="tabela-przewijana"><table class="tabela">
      <thead><tr><th scope="col"></th><th scope="col" class="kwota">${esc(etykietaMiesiaca(m))}</th>
        <th scope="col" class="kwota">Od początku ${y}</th></tr></thead>
      <tbody>
        <tr><th scope="row">Przychód</th><td class="kwota">${zl(miesiac.przychodGr)}</td><td class="kwota">${zl(rok.przychodGr)}</td></tr>
        <tr><th scope="row">Koszty</th><td class="kwota">− ${zl(miesiac.kosztyGr)}</td><td class="kwota">− ${zl(rok.kosztyGr)}</td></tr>
        <tr><th scope="row">Ryczałt (szac.)</th><td class="kwota">− ${zl(miesiac.ryczaltGr)}</td><td class="kwota">− ${zl(rok.ryczaltGr)}</td></tr>
        <tr><th scope="row"><strong>Zysk</strong></th><td class="kwota"><strong>${kwotaZysku(miesiac.zyskGr)}</strong></td>
          <td class="kwota"><strong>${kwotaZysku(rok.zyskGr)}</strong></td></tr>
      </tbody></table></div>
    ${kategorie}
    ${!s.dane.expenses?.length ? '<p class="maly wyciszony">Nie ma jeszcze kosztów – wczytaj wyciąg z wypływami albo dodaj koszt ręcznie.</p>' : ''}
    <p><a class="link-btn" href="#/koszty">Koszty ›</a> · <button type="button" class="link-btn" data-akcja="idz" data-ekran="raporty">Zysk według jednostek ›</button></p>`;
}

/** Karta „Ryczałt” (8.1 nr 9): bieżący kwartał osobno dla każdego licznika – przychód, ryczałt, próg 100 000 zł. */
function kartaRyczaltu(s, dzis) {
  const u = ustawienia(s);
  const rok = Number(dzis.slice(0, 4));
  const q = kwartalDaty(dzis);
  const { od } = datyKwartalu(rok, q);
  const liczniki = GRUPY_RYCZALTU.map((g) => {
    const dane = daneGrupy(s.dane, g.id);
    const k = zestawienieRoku(dane, { rok, dzis, ustawienia: u }).kwartaly[q - 1];
    return `<h3 class="naglowek-licznika">${esc(g.nazwa)}</h3>
      <dl class="opis-pol">
        <dt>Przychód kwartału</dt><dd class="kwota">${formatZl(k.przychodGr, { grosze: false })}</dd>
        <dt>Ryczałt szacunkowy</dt><dd class="kwota"><strong>${formatZl(k.ryczaltGr, { grosze: false })}</strong></dd>
      </dl>
      ${opisProgu(progRoku(dane.payments, { rok, dzis, ustawienia: u }), u)}`;
  }).join('');
  return `<p class="wyciszony">${etykietaKwartalu(q)} ${rok}: ${formatData(od)} – dziś · termin ${formatData(zestawienieRoku(s.dane, { rok, dzis, ustawienia: u }).kwartaly[q - 1].termin)}</p>
    ${liczniki}
    <p><button type="button" class="link-btn" data-akcja="idz" data-ekran="raporty" data-filtr="rok">Wszystkie kwartały i wpłaty ›</button></p>`;
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
    const p = policz(s);
    const brakKwota = p.brakujace.reduce((x, b) => x + b.kwotaGr, 0);
    const poTerminie = p.brakujace.some((b) => b.termin < p.dzis);
    return `
      ${wyborMiesiaca(s)}
      
      <div class="kafelki">
        ${kafelek('Należne', formatZl(p.naleznoGr), odmiana(p.najmyMiesiaca, ['najem', 'najmy', 'najmów']))}
        ${kafelek('Wpłynęło', formatZl(p.wplynelo), 'przychód kasowy')}
        ${kafelek('Brakuje', formatZl(brakKwota), odmiana(p.brakujace.length, ['przelew', 'przelewy', 'przelewów']),
    poTerminie ? 'zalega' : '')}
        ${kafelek('Zaległości razem', formatZl(p.zaleglosciGr), odmiana(p.dluznicy.length, ['dłużnik', 'dłużników', 'dłużników']))}
      </div>
      <div class="siatka">
        <section class="karta" aria-labelledby="k-brakujace"><h2 id="k-brakujace">Brakujące wpłaty w ${miesiacW}</h2>
          ${listaBrakujacych(p.brakujace, p.dzis)}</section>
        <section class="karta" aria-labelledby="k-dluznicy"><h2 id="k-dluznicy">Najwięksi dłużnicy</h2>
          ${listaDluznikow(p.dluznicy, s, p.dzis)}</section>
        <section class="karta" aria-labelledby="k-oblozenie"><h2 id="k-oblozenie">Obłożenie</h2>
          ${oblozenie(s, p.dzis)}</section>
        <section class="karta" aria-labelledby="k-konczace"><h2 id="k-konczace">Kończące się najmy</h2>
          ${konczaceNajmy(s, p.dzis)}</section>
        <section class="karta" aria-labelledby="k-zysk"><h2 id="k-zysk">Zysk</h2>
          ${kartaZysku(s, p.dzis)}</section>
        <section class="karta" aria-labelledby="k-ryczalt"><h2 id="k-ryczalt">Ryczałt</h2>
          ${kartaRyczaltu(s, p.dzis)}</section>
      </div>`;
  },

  poRenderze: pokazWybranyMiesiac,
};
