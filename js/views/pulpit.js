// Pulpit (8.1): „Jak wygląda wybrany miesiąc i kto zalega?”
// Liczby z rozliczenia klientów (rozliczenia.js): należne, wpłynęło, brakuje (5.6), zaległości (5.4), obłożenie.

import { DNI_BEZ_IMPORTU, TYPY_JEDNOSTEK } from '../config.js';
import { krokiMiesiaca, postep, reczneKroki } from '../kreator.js';
import { zalegajacy } from './przypomnienia.js';
import { koniecUmowy } from './jednostki.js';
import { biezacyNajem, doPrzypisania, najemTrwa, planowanyKoniec } from '../dane.js';
import { zadania } from '../zadania.js';
import { nazwaKategorii, zyskZakresu } from '../koszty.js';
import { bramyDoZrobienia } from '../bramy.js';
import { doRozliczenia, kwartalDoRozliczenia } from '../prad.js';
import { limityVat, PROGI_VAT } from '../statystyki.js';
import {
  daneGrupy, datyKwartalu, etykietaKwartalu, GRUPY_RYCZALTU, kwartalDaty, kwartalyDoZaplaty, nazwaGrupy, progRoku,
  zestawienieRoku,
} from '../podatek.js';
import { pustyStan } from '../ui.js';
import {
  dodajDni, esc, dzisiaj, etykietaMiesiaca, formatZl, formatData, kluczMiesiaca, MIESIACE_W, odmiana, porownajKody, roznicaDni,
} from '../utils.js';
import { opisProgu, rozliczeniaKlientow, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const LICZBA_DLUZNIKOW = 5;

function kafelek(etykieta, wartosc, opis, klasa = '') {
  return `<div class="kafelek${klasa ? ` ${klasa}` : ''}"><span class="etykieta">${etykieta}</span>
    <span class="wartosc">${wartosc}</span><span class="opis">${opis}</span></div>`;
}

// ---------------------------------------------------------------------
// „Do zrobienia” (0.24.0): jedna lista zamiast pasków – od najpilniejszego, każda pozycja z przyciskiem akcji.
// Pilność: 0 – po terminie / pilne, 1 – na dziś, 2 – wkrótce, 3 – do wiadomości.
// ---------------------------------------------------------------------

const POKAZ_OD_RAZU = 7;
const ETYKIETY_PILNOSCI = ['pilne', 'dziś', 'wkrótce', 'info'];
const KLASY_PILNOSCI = ['zalega', 'czesciowo', 'zajeta', 'wylaczona'];

const link = (tekst, href, drugi = false) => `<a class="przycisk maly${drugi ? ' drugi' : ''}" href="${esc(href)}">${esc(tekst)}</a>`;
const idz = (tekst, ekran, filtr, drugi = false) => `<button type="button" class="przycisk maly${drugi ? ' drugi' : ''}" data-akcja="idz"
  data-ekran="${esc(ekran)}"${filtr ? ` data-filtr="${esc(filtr)}"` : ''}>${esc(tekst)}</button>`;

/** Zebrane pozycje „Do zrobienia”, posortowane od najpilniejszej. */
export function doZrobienia(s, dzis = dzisiaj()) {
  const lista = [];
  const dodaj = (pilnosc, tytul, opis, akcje) => lista.push({ pilnosc, tytul, opis, akcje });

  // Zadania (notatki z terminem): każde osobno, z „Zrobione”.
  const zadaniaPilne = zadania(s.dane.client_notes).filter((n) => n.promised_on <= dzis)
    .sort((a, b) => a.promised_on.localeCompare(b.promised_on));
  for (const n of zadaniaPilne.slice(0, 5)) {
    const klient = s.indeksy.klienci.get(n.client_id);
    const po = roznicaDni(n.promised_on, dzis);
    dodaj(po > 0 ? 0 : 1, `${esc(klient?.name ?? 'Klient')}: ${esc(n.body.length > 80 ? `${n.body.slice(0, 80)}…` : n.body)}`,
      po > 0 ? `zadanie ${dni(po)} po terminie` : 'zadanie na dziś',
      `<button type="button" class="przycisk maly" data-akcja="zadanie-zrobione" data-id="${esc(n.id)}" data-zrobione="1">Zrobione</button>
       ${link('Karta klienta', `#/klienci/${encodeURIComponent(n.client_id)}`, true)}`);
  }
  if (zadaniaPilne.length > 5) {
    dodaj(1, `I jeszcze ${odmiana(zadaniaPilne.length - 5, ['zadanie', 'zadania', 'zadań'])} na dziś i po terminie`, '',
      idz('Zadania', 'zadania', 'do-zrobienia'));
  }

  // Bramy: numery do usunięcia (koniec najmu + 3 dni) – każdy osobno; do przypisania – osobno albo zbiorczo.
  if (s.dane.gates?.length) {
    const b = bramyDoZrobienia(s, dzis);
    for (const x of b.doUsuniecia) {
      dodaj(0, `Usuń z bramy ${x.numer}: ${esc(x.klient.name)}`,
        `numer ${esc(x.dostep.phone)}${x.dostep.slot != null ? `, pozycja ${x.dostep.slot}` : ''} – od ${formatData(x.usunOd)}`,
        link('Usuń z bramy', `#/bramy/${encodeURIComponent(x.klient.id)}?brama=${x.numer}`));
    }
    const nowe = b.doPrzypisania.filter((x) => x.najmy.some((n) => n.start_on <= dodajDni(dzis, 7)));
    if (nowe.length > 3) {
      dodaj(2, `Bramy: ${odmiana(nowe.length, ['numer czeka', 'numery czekają', 'numerów czeka'])} na przypisanie`,
        'klienci z najmem bez dostępu do bramy', link('Bramy', '#/bramy'));
    } else {
      for (const x of nowe) {
        dodaj(1, `Przypisz do bramy ${x.numer}: ${esc(x.klient.name)}`, 'najem bez dostępu do bramy',
          link('Przypisz', `#/bramy/${encodeURIComponent(x.klient.id)}?brama=${x.numer}`));
      }
    }
  }

  // Najmy do zakończenia: po dacie końca bez „Zakończ najem” – pilne; w ciągu 7 dni – wkrótce. Akcja: kreator końca.
  for (const n of s.dane.rentals) {
    const koniec = n.end_on ? null : n.notice_end_on ?? null;
    if (!koniec || koniec > dodajDni(dzis, 7)) continue;
    const klient = s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);
    const kod = s.indeksy.jednostki.get(n.unit_id)?.code ?? '?';
    const minelo = koniec < dzis;
    dodaj(minelo ? 0 : 2, `${minelo ? 'Zakończ najem' : 'Kończy się najem'} ${esc(kod)} · ${esc(klient?.name ?? '—')}`,
      `koniec najmu ${formatData(koniec)}${minelo ? '' : koniec === dzis ? ' (dziś)' : ` (za ${dni(roznicaDni(dzis, koniec))})`}`,
      link('Krok po kroku', `#/kreator/koniec/${encodeURIComponent(n.id)}`, !minelo));
  }

  // Wpłaty do przypisania – zbiorczo, „Przypisz” otwiera najstarszą.
  const nieprzypisane = doPrzypisania(s.dane.payments).sort((a, b) => a.booked_on.localeCompare(b.booked_on));
  if (nieprzypisane.length) {
    dodaj(1, `${odmiana(nieprzypisane.length, ['wpłata czeka', 'wpłaty czekają', 'wpłat czeka'])} na przypisanie`,
      `najstarsza z ${formatData(nieprzypisane[0].booked_on)}`,
      `${nieprzypisane[0].method === 'przelew' ? link('Przypisz', `#/wplaty/${encodeURIComponent(nieprzypisane[0].id)}/przypisz`) : ''}
       ${idz('Lista', 'wplaty', 'do-przypisania', true)}`);
  }

  // Zalegający bez przypomnienia od 7 dni.
  const zalegli = zalegajacy(s, dzis);
  const bezPrzyp = zalegli.filter((x) => x.doPrzypomnienia);
  if (bezPrzyp.length) {
    const kwota = bezPrzyp.reduce((a, x) => a + x.d.kwotaGr, 0);
    dodaj(1, `${odmiana(bezPrzyp.length, ['klient zalega', 'klientów zalega', 'klientów zalega'])} – wyślij przypomnienia`,
      `razem ${formatZl(kwota, { grosze: false })}`, link('Przypomnij', '#/przypomnienia'));
  }

  // Miesięczny przegląd – od 20. dnia (termin płatności), dopóki nie wszystko zrobione.
  const u = ustawienia(s);
  const dzien = Number(u.default_billing_day) || 20;
  if (Number(dzis.slice(8, 10)) >= dzien) {
    const m = kluczMiesiaca(dzis);
    const termin = `${m}-${String(dzien).padStart(2, '0')}`;
    const p = postep(krokiMiesiaca(s, { miesiac: m, dzis, reczne: reczneKroki(`miesiac:${m}`), terminDzien: dzien,
      doPrzypomnienia: zalegli.filter((x) => !x.ostatnie || x.ostatnie < termin).length }));
    if (p.gotowe < p.razem) {
      dodaj(2, `Miesięczny przegląd: ${esc(etykietaMiesiaca(m))}`, `${p.gotowe} z ${p.razem} kroków gotowe`,
        link('Otwórz', '#/kreator/miesiac'));
    }
  }

  // Prąd: od 7 dni przed końcem kwartału do 30 dni po nim.
  if (s.dane.units.some((j) => j.has_power)) {
    const kw = kwartalDoRozliczenia(dzis);
    const brak = dzis >= dodajDni(kw.do, -7) ? doRozliczenia(s.dane, s.indeksy, kw) : [];
    if (brak.length) {
      dodaj(dzis > kw.do ? 1 : 2, `Prąd ${esc(kw.nazwa)}: ${odmiana(brak.length, ['jednostka czeka', 'jednostki czekają', 'jednostek czeka'])} na odczyt licznika`,
        '', link('Odczyty', '#/prad'));
    }
  }

  // Ryczałt: po terminie – pilne; najbliższy do zapłaty – na 7 dni przed terminem „dziś”, wcześniej „wkrótce”.
  const ryczalt = kwartalyDoZaplaty(s.dane, { dzis, ustawienia: u });
  for (const g of GRUPY_RYCZALTU) {
    const wGrupie = ryczalt.filter((k) => k.grupa === g.id);
    const zalegle = wGrupie.filter((k) => k.status !== 'do_zaplaty');
    if (zalegle.length) {
      const k = zalegle[0];
      dodaj(0, `Ryczałt (${esc(g.nazwa)}) po terminie lub niedopłacony`, esc(zalegle.map((x) => `${etykietaKwartalu(x.q)} ${x.rok}`).join(', ')),
        link('Wpisz wpłatę', `#/raporty/ryczalt/${k.rok}-${k.q}-${g.id}`));
    }
    const k = wGrupie.find((x) => x.status === 'do_zaplaty');
    if (k) {
      dodaj(roznicaDni(dzis, k.termin) <= 7 ? 1 : 2, `Ryczałt (${esc(nazwaGrupy(g.id))}) za ${etykietaKwartalu(k.q)} ${k.rok}: ${formatZl(k.doZaplatyGr, { grosze: false })}`,
        `do zapłaty do ${formatData(k.termin)}`, link('Szczegóły', `#/raporty/ryczalt/${k.rok}-${k.q}-${g.id}`, true));
    }
  }

  // Limity VAT: od 80% – wkrótce, od 95% i po przekroczeniu – pilne.
  for (const l of limityVat(s.dane, { rok: Number(dzis.slice(0, 4)), dzis, limitGr: u.vat_limit_gr })) {
    if (l.udzial < PROGI_VAT[0] && !l.przekroczono) continue;
    dodaj(l.przekroczono || l.udzial >= PROGI_VAT[1] ? 0 : 2, l.przekroczono
      ? `Limit VAT przekroczony (${esc(l.nazwa)}) ${formatData(l.dataPrzekroczenia)}`
      : `Limit VAT – ${esc(l.nazwa)}: ${Math.round(l.udzial * 100)}% z ${formatZl(l.limitGr, { grosze: false })}`, '', idz('Raporty', 'raporty', null, true));
  }

  // Umowy na czas określony kończące się w ciągu settings.expiring_days dni albo wygasłe (Z10).
  const konczace = s.dane.units.filter((j) => !j.archived).filter((j) => {
    const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzis);
    return najem && koniecUmowy(s.indeksy.umowy.get(najem.contract_id), najem, s, dzis);
  }).length;
  if (konczace) {
    dodaj(2, `Umowy kończące się w ciągu ${u.expiring_days} dni lub wygasłe: ${konczace}`, '', idz('Pokaż', 'jednostki', 'konczace', true));
  }

  // Konta bez importu od DNI_BEZ_IMPORTU dni (albo jeszcze bez żadnego wyciągu).
  for (const konto of s.dane.bank_accounts.filter((k) => !k.archived)) {
    const ostatni = s.dane.imports.filter((i) => i.bank_account_id === konto.id)
      .reduce((m, i) => (i.imported_at > m ? i.imported_at : m), '');
    const ile = ostatni ? roznicaDni(ostatni.slice(0, 10), dzis) : null;
    if (ile == null || ile >= DNI_BEZ_IMPORTU) {
      dodaj(3, ile == null ? `Nie wczytano jeszcze wyciągu z konta ${esc(konto.name)}` : `Brak importu z konta ${esc(konto.name)} od ${ile} dni`,
        '', link('Import', '#/import', true));
    }
  }

  return lista.map((x, i) => ({ ...x, i })).sort((a, b) => a.pilnosc - b.pilnosc || a.i - b.i);
}

function pozycja(x) {
  return `<li class="do-zrobienia-pozycja p${x.pilnosc}">
    <span class="status ${KLASY_PILNOSCI[x.pilnosc]}"><span class="sr-only">${ETYKIETY_PILNOSCI[x.pilnosc]}: </span></span>
    <div class="glowna"><strong>${x.tytul}</strong>${x.opis ? `<span>${x.opis}</span>` : ''}</div>
    <div class="akcje">${x.akcje}</div></li>`;
}

/** Karta „Do zrobienia” na górze Pulpitu. */
function kartaDoZrobienia(s) {
  const lista = doZrobienia(s);
  const pilne = lista.filter((x) => x.pilnosc === 0).length;
  const naglowek = `<h2 id="k-do-zrobienia">Do zrobienia ${lista.length ? `<span class="liczba-pozycji">${lista.length}</span>` : ''}${
    pilne ? ` <span class="status zalega maly">${odmiana(pilne, ['pilne', 'pilne', 'pilnych'])}</span>` : ''}</h2>`;
  if (!lista.length) {
    return `<section class="karta szeroka do-zrobienia" aria-labelledby="k-do-zrobienia">${naglowek}
      <p class="wyciszony"><span class="status ok">Wszystko zrobione</span> – nic nie czeka.</p></section>`;
  }
  const reszta = lista.slice(POKAZ_OD_RAZU);
  return `<section class="karta szeroka do-zrobienia" aria-labelledby="k-do-zrobienia">${naglowek}
    <ul class="lista">${lista.slice(0, POKAZ_OD_RAZU).map(pozycja).join('')}</ul>
    ${reszta.length ? `<details class="wiecej-pozycji"><summary>Pokaż jeszcze ${reszta.length}</summary>
      <ul class="lista">${reszta.map(pozycja).join('')}</ul></details>` : ''}</section>`;
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
      ${kartaDoZrobienia(s)}
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
