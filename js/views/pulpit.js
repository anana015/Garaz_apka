// Pulpit (8.1): „Jak wygląda wybrany miesiąc i kto zalega?”
// Liczby z rozliczenia klientów (rozliczenia.js): należne, wpłynęło, brakuje (5.6), zaległości (5.4), obłożenie.

import { DNI_BEZ_IMPORTU, TYPY_JEDNOSTEK } from '../config.js';
import { koniecUmowy } from './jednostki.js';
import { biezacyNajem, doPrzypisania, najemTrwa } from '../dane.js';
import { pilneZadania } from '../zadania.js';
import { limityVat, PROGI_VAT } from '../statystyki.js';
import { pustyStan, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, formatZl, formatData, kluczMiesiaca, MIESIACE_W, odmiana, porownajKody, roznicaDni,
} from '../utils.js';
import { rozliczeniaKlientow, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const LICZBA_DLUZNIKOW = 5;

function kafelek(etykieta, wartosc, opis, klasa = '') {
  return `<div class="kafelek${klasa ? ` ${klasa}` : ''}"><span class="etykieta">${etykieta}</span>
    <span class="wartosc">${wartosc}</span><span class="opis">${opis}</span></div>`;
}

function paskiOstrzezen(s) {
  const paski = [];
  const n = doPrzypisania(s.dane.payments).length;
  if (n) {
    paski.push(`<button type="button" class="baner ostrzezenie pelny-wiersz" data-akcja="idz"
      data-ekran="wplaty" data-filtr="do-przypisania">${odmiana(n, ['wpłata czeka', 'wpłaty czekają', 'wpłat czeka'])} na przypisanie ›</button>`);
  }
  const z = pilneZadania(s.dane.client_notes, dzisiaj());
  if (z) {
    paski.push(`<button type="button" class="baner ostrzezenie pelny-wiersz" data-akcja="idz"
      data-ekran="zadania" data-filtr="do-zrobienia">${odmiana(z, ['zadanie', 'zadania', 'zadań'])} na dziś i po terminie ›</button>`);
  }
  // Umowy na czas określony kończące się w ciągu settings.expiring_days dni albo już wygasłe (Z10).
  const dzis = dzisiaj();
  const konczace = s.dane.units.filter((j) => !j.archived).filter((j) => {
    const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzis);
    return najem && koniecUmowy(s.indeksy.umowy.get(najem.contract_id), najem, s, dzis);
  }).length;
  if (konczace) {
    paski.push(`<button type="button" class="baner ostrzezenie pelny-wiersz" data-akcja="idz"
      data-ekran="jednostki" data-filtr="konczace">Umowy kończące się w ciągu ${ustawienia(s).expiring_days} dni lub wygasłe: ${konczace} ›</button>`);
  }
  // Konta bez importu od DNI_BEZ_IMPORTU dni (albo jeszcze bez żadnego wyciągu).
  for (const konto of s.dane.bank_accounts.filter((k) => !k.archived)) {
    const ostatni = s.dane.imports.filter((i) => i.bank_account_id === konto.id)
      .reduce((m, i) => (i.imported_at > m ? i.imported_at : m), '');
    const dni = ostatni ? roznicaDni(ostatni.slice(0, 10), dzis) : null;
    if (dni == null || dni >= DNI_BEZ_IMPORTU) {
      paski.push(`<a class="baner pelny-wiersz" href="#/import">${dni == null
        ? `Nie wczytano jeszcze wyciągu z konta ${esc(konto.name)}` : `Brak importu z konta ${esc(konto.name)} od ${dni} dni`} ›</a>`);
    }
  }
  // Limity VAT (6.4): ostrzeżenie od 80%, pilne od 95% i po przekroczeniu.
  for (const l of limityVat(s.dane, { rok: Number(dzis.slice(0, 4)), dzis, limitGr: ustawienia(s).vat_limit_gr })) {
    if (l.udzial < PROGI_VAT[0] && !l.przekroczono) continue;
    const tekst = l.przekroczono ? `Limit VAT przekroczony (${l.nazwa}) ${formatData(l.dataPrzekroczenia)}`
      : `Limit VAT – ${l.nazwa}: ${Math.round(l.udzial * 100)}% z ${formatZl(l.limitGr, { grosze: false })}`;
    paski.push(`<button type="button" class="baner ${l.przekroczono || l.udzial >= PROGI_VAT[1] ? 'blad' : 'ostrzezenie'} pelny-wiersz"
      data-akcja="idz" data-ekran="raporty">${esc(tekst)} ›</button>`);
  }
  // Kolejny pasek (ryczałt do zapłaty) – następna porcja kroku 1d.
  return paski.join('');
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
      ${paskiOstrzezen(s)}
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
        <section class="karta" aria-labelledby="k-ryczalt"><h2 id="k-ryczalt">Ryczałt</h2>
          ${wPlanie('Przychód kwartału, ryczałt i pasek progu 100 000 zł – krok 1d.')}</section>
      </div>`;
  },

  poRenderze: pokazWybranyMiesiac,
};
