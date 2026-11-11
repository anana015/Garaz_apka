// Klienci (8.4), karta klienta (8.5) i formularz klienta (8.6).
// Adresy: #/klienci, #/klienci/nowy[?dalej=najem&jednostka=<id>], #/klienci/<id>, #/klienci/<id>/edycja,
// #/klienci/<id>/notatka[?rodzaj=obietnica], #/klienci/<id>/kaucja (dodanie kaucji),
// #/klienci/<id>/wypowiedzenie, #/klienci/<id>/umowa[?najem=<id>] (umowa do podpisania z wzoru – views/umowy.js). Tryb „Edytuj” na karcie = zwarte „Ustawienia klienta” z rozwijanymi grupami.

import { najemTrwa, najemZakonczony, opisPlatnosci, stawkaNaDzien } from '../dane.js';
import {
  formularz, maBledy, obszar, opcje, pole, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz,
} from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, przyciskEdycji } from '../ui.js';
import {
  dataZeZnacznika, dodajMiesiace, esc, dzisiaj, etykietaMiesiaca, formatData, formatDataKrotka, formatRachunek, formatZl, kwotaDoPola, normalizujTekst, parseKwota, porownajKody,
} from '../utils.js';
import {
  saldoKaucji, TYPY_DOKUMENTU, walidujKaucje, walidujKlienta, walidujPdf, walidujWypowiedzenie,
} from '../walidacja.js';
import { grupa, grupaNajmu, menu, pozycja } from './edycja.js';
import { akcjeAnulowania } from './edycja.js';
import { promocjaNajmu } from '../promocje.js';
import { koniecUmowy } from './jednostki.js';
import { pokazTerminowosc, rozliczeniaKlientow, ustawienia } from './wspolne.js';
import { PROGI_TERMINOWOSCI, bezKaucji } from '../config.js';
import { doCsv } from '../csv.js';
import { kartoteka, terminowosc } from '../rozliczenia.js';
import { KTO, RODZAJE_NOTATEK } from '../zadania.js';
import { formularzeUmowy, formularzUmowy, najmyDoUmowy } from './umowy.js';
import { kartaBramKlienta } from './bramy.js';
import { bramaJednostki } from '../bramy.js';
import { akcjePrzypomnienia, formularzeprzypomnienia, przypomnienie } from './przypomnienie.js';

/** Klient aktywny: niezarchiwizowany i bez najmów albo z najmem, który się nie skończył. */
function czyAktywny(klient, najmy, dzien) {
  if (klient.archived) return false;
  return najmy.length === 0 || najmy.some((n) => !najemZakonczony(n, dzien));
}

const FILTRY = {
  aktywni: { tekst: 'Aktywni', warunek: (k, najmy, d) => czyAktywny(k, najmy, d) },
  dluznicy: { tekst: 'Dłużnicy', warunek: (k, najmy, d, r) => !k.archived && Boolean(r?.dluznik) },
  byli: { tekst: 'Byli', warunek: (k, najmy, d) => !czyAktywny(k, najmy, d) },
  niepelne: { tekst: 'Niepełne dane', warunek: (k, najmy, d) => czyAktywny(k, najmy, d) && brakiDanych(k).length > 0 },
  wszyscy: { tekst: 'Wszyscy', warunek: () => true },
};

/** Filtr „Płaci” na liście klientów: według miejsca płatności trwających najmów (decyzja 4). */
function opcjePlatnosci(s) {
  const konta = s.dane.bank_accounts.filter((k) => !k.archived).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  return [
    { id: 'wszyscy', tekst: 'Wszyscy', pasuje: () => true },
    ...konta.map((k) => ({ id: `konto:${k.id}`, tekst: k.name,
      pasuje: (n) => (n.pay_method ?? 'przelew') === 'przelew' && n.bank_account_id === k.id })),
    { id: 'nieustalone', tekst: 'Konto nieustalone', pasuje: (n) => (n.pay_method ?? 'przelew') === 'przelew' && !n.bank_account_id },
    { id: 'gotowka', tekst: 'Gotówka', pasuje: (n) => n.pay_method === 'gotowka' },
    { id: 'fv', tekst: 'FV', pasuje: (n) => n.pay_method === 'fv' },
    { id: 'inne-konto', tekst: 'Przelew na inne konto', klient: true },
  ];
}


/**
 * Ostatni przelew czynszu (z ostatnich 120 dni) na konto inne niż ustalone przy trwających najmach klienta.
 * null, gdy klient nie ma ustalonego konta albo wszystko się zgadza.
 */
export function przelewNaInneKonto(s, klient, dzien = dzisiaj()) {
  const najmy = (s.indeksy.najmyKlienta.get(klient.id) ?? []).filter((n) => !najemZakonczony(n, dzien));
  const ustalone = new Set(najmy.filter((n) => (n.pay_method ?? 'przelew') === 'przelew' && n.bank_account_id)
    .map((n) => n.bank_account_id));
  if (!ustalone.size) return null;
  const od = dodajMiesiace(dzien, -4);
  const wplata = s.dane.payments
    .filter((w) => w.client_id === klient.id && w.kind === 'czynsz' && w.method === 'przelew' && w.amount_gr > 0
      && w.bank_account_id && w.booked_on >= od && !ustalone.has(w.bank_account_id))
    .sort((a, b) => b.booked_on.localeCompare(a.booked_on))[0];
  if (!wplata) return null;
  return { wplata, konto: s.indeksy.konta.get(wplata.bank_account_id),
    ustalone: [...ustalone].map((id) => s.indeksy.konta.get(id)?.name ?? '?') };
}

/** Brakujące obowiązkowe dane klienta (prośba 11.11): telefon, e-mail, adres. */
export const brakiDanych = (k) => [!k.phone && 'telefon', !k.email && 'e-mail', !k.address && 'adres'].filter(Boolean);

function kodyJednostek(najmy, s, dzien) {
  return najmy.filter((n) => !najemZakonczony(n, dzien))
    .map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
}

/** Baner na karcie klienta: ostatni przelew przyszedł na inne konto niż ustalone przy najmie. */
function ostrzezenieKonta(s, klient, dzien) {
  const x = przelewNaInneKonto(s, klient, dzien);
  if (!x) return '';
  return `<p class="baner ostrzezenie">Przelew ${formatZl(x.wplata.amount_gr)} z ${formatData(x.wplata.booked_on)} wpłynął na
    <strong>${esc(x.konto?.name ?? 'inne konto')}</strong>, a ustalone jest: ${esc(x.ustalone.join(', '))}.
    Zmień „Gdzie płaci” w trybie „Edytuj”, jeśli klient płaci teraz na to konto.</p>`;
}

/** Saldo w wierszu listy (8.4): zaległość na czerwono albo „opłacone do” na zielono. */
function stanSalda(r, s, k) {
  if (!r) return '';
  if (r.zalegloscGr > 0) {
    return `<div class="kwota">${formatZl(-r.zalegloscGr)}</div>
      <div class="maly"><span class="status ${r.dluznik ? 'zalega' : 'czesciowo'}">${r.dniPoTerminie} ${
  r.dniPoTerminie === 1 ? 'dzień' : 'dni'} po terminie</span></div>`;
  }
  const dzien = dzisiaj();
  const trwajace = (s.indeksy.najmyKlienta.get(k.id) ?? []).filter((n) => !najemZakonczony(n, dzien));
  const daty = trwajace.map((n) => r.oplaconeDo.get(n.id)).filter(Boolean);
  const najblizsza = daty.length ? daty.sort()[0] : null;
  return `${r.saldoGr > 0 ? `<div class="kwota">+${formatZl(r.saldoGr)}</div>` : ''}
    ${najblizsza ? `<div class="maly"><span class="status ok">opłacone do ${formatDataKrotka(najblizsza)}</span></div>`
    : r.saldoGr === 0 ? '<div class="maly wyciszony">rozliczony</div>' : ''}`;
}

function lista(s) {
  const dzien = dzisiaj();
  const filtr = s.ui.filtry.klienci ?? 'aktywni';
  const platnosci = opcjePlatnosci(s);
  const platnosc = platnosci.find((o) => o.id === s.ui.platnoscKlientow) ?? platnosci[0];
  const szukane = normalizujTekst(s.ui.szukaj.klienci);
  const akcje = `<div class="pasek-akcji">${przycisk({ tekst: 'Nowy klient', href: '#/klienci/nowy', ikona: 'plus' })}</div>`;

  if (!s.dane.clients.length) {
    return akcje + pustyStan('Nie ma jeszcze klientów. Dodaj klienta albo wczytaj dane startowe.', [
      { tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true }]);
  }

  const rozl = rozliczeniaKlientow(s);
  const wiersze = s.dane.clients
    .map((k) => ({ k, najmy: s.indeksy.najmyKlienta.get(k.id) ?? [], r: rozl.get(k.id) }))
    .filter(({ k, najmy, r }) => FILTRY[filtr].warunek(k, najmy, dzien, r))
    .filter(({ k, najmy }) => {
      if (!platnosc || platnosc.id === 'wszyscy') return true;
      if (platnosc.klient) return Boolean(przelewNaInneKonto(s, k, dzien));
      return najmy.some((n) => !najemZakonczony(n, dzien) && platnosc.pasuje(n));
    })
    .map(({ k, najmy, r }) => ({ k, r, kody: kodyJednostek(najmy, s, dzien) }))
    .filter(({ k, kody }) => !szukane || normalizujTekst(
      `${k.name} ${k.phone ?? ''} ${k.nip ?? ''} ${kody.join(' ')}`).includes(szukane))
    .map((w) => ({ ...w, t: w.r ? wynikTerminowosci(s, w.r) : null }));
  const sort = s.ui.sortKlienci ?? (filtr === 'dluznicy' ? 'zaleglosc' : 'nazwa');
  const poNazwie = (a, b) => a.k.name.localeCompare(b.k.name, 'pl');
  wiersze.sort({
    nazwa: poNazwie,
    zaleglosc: (a, b) => (b.r?.zalegloscGr ?? 0) - (a.r?.zalegloscGr ?? 0) || poNazwie(a, b),
    // Najpierw najsłabsza terminowość; „za mało danych” na końcu.
    terminowosc: (a, b) => (a.t?.procent ?? 2) - (b.t?.procent ?? 2) || poNazwie(a, b),
  }[sort] ?? poNazwie);
  const sortowanie = `<div class="filtry sortowanie" role="group" aria-label="Sortowanie">
    <span class="wyciszony maly">Sortuj:</span>${Object.entries({ nazwa: 'nazwa', zaleglosc: 'zaległość', terminowosc: 'terminowość' })
    .map(([id, tekst]) => `<button type="button" data-akcja="sort-klienci" data-wartosc="${id}" aria-pressed="${id === sort}">${tekst}</button>`).join('')}</div>`;
  const liczbaDluznikow = s.dane.clients.filter((k) => !k.archived && rozl.get(k.id)?.dluznik).length;
  const liczbaNiepelnych = s.dane.clients.filter((k) => FILTRY.niepelne.warunek(k, s.indeksy.najmyKlienta.get(k.id) ?? [], dzien)).length;

  let tresc;
  if (!wiersze.length) {
    tresc = pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.'
      : filtr === 'dluznicy' ? 'Nikt nie zalega.' : 'Brak klientów w tym widoku.');
  } else {
    tresc = `<ul class="lista">${wiersze.map(({ k, r, t: term, kody }) => `<li>
      <a class="wiersz" href="#/klienci/${encodeURIComponent(k.id)}">
        <div class="glowna"><strong>${esc(k.name)}</strong>
          <span>${kody.length ? kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('') : 'brak aktywnych najmów'}</span>
          ${filtr === 'niepelne' ? `<span class="status czesciowo">brak: ${esc(brakiDanych(k).join(', '))}</span>` : ''}</div>
        <div class="prawa">${stanSalda(r, s, k)}${przelewNaInneKonto(s, k, dzien)
    ? '<div class="maly"><span class="status czesciowo">przelew na inne konto</span></div>' : ''}${term && term.etykieta !== 'Za mało danych'
    ? `<div class="maly wyciszony">${esc(term.etykieta)}</div>` : ''}</div>
      </a></li>`).join('')}</ul>`;
  }

  return `${akcje}
    ${filtry(Object.entries(FILTRY).map(([id, f]) => ({ id, tekst: f.tekst,
    liczba: id === 'dluznicy' ? liczbaDluznikow : id === 'niepelne' ? liczbaNiepelnych : undefined }))
    .filter((o) => o.id !== 'niepelne' || o.liczba || filtr === 'niepelne'), filtr, 'Grupa klientów')}
    <details class="wiecej-filtrow"${platnosc.id !== 'wszyscy' || s.ui.sortKlienci ? ' open' : ''}>
      <summary>Więcej filtrów i sortowanie${platnosc.id !== 'wszyscy' ? ` · płaci: ${esc(platnosc.tekst)}` : ''}</summary>
      <div class="filtry sortowanie" role="group" aria-label="Gdzie płaci">
        <span class="wyciszony maly">Płaci:</span>${platnosci.map((o) => `<button type="button" data-akcja="platnosc-klienci"
          data-wartosc="${esc(o.id)}" aria-pressed="${o.id === platnosc.id}">${esc(o.tekst)}</button>`).join('')}</div>
      ${sortowanie}
    </details>
    ${poleSzukaj('klienci', s.ui.szukaj.klienci, 'Szukaj po nazwie, telefonie, NIP, jednostce')}
    <section class="karta">${tresc}</section>`;
}

// ---------------------------------------------------------------------
// Karta klienta (8.5)
// ---------------------------------------------------------------------

function opis(etykieta, wartosc) {
  return wartosc ? `<dt>${etykieta}</dt><dd>${wartosc}</dd>` : '';
}

const OKRES_SLOWNIE = { 1: 'co miesiąc', 3: 'co kwartał', 6: 'co pół roku', 12: 'co rok' };

function wierszNajmu(s, n, dzien) {
  const j = s.indeksy.jednostki.get(n.unit_id);
  const umowa = s.indeksy.umowy.get(n.contract_id);
  const stawki = [...(s.indeksy.stawkiNajmu.get(n.id) ?? [])].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const stawka = stawkaNaDzien(stawki, najemTrwa(n, dzien) ? dzien : n.end_on ?? n.start_on);
  const trwa = !najemZakonczony(n, dzien);
  const koniec = koniecUmowy(umowa, n, s, dzien);
  const id = encodeURIComponent(n.id);
  const szczegoly = [
    `płatne ${n.billing_day}. dnia ${OKRES_SLOWNIE[n.period_months] ?? ''}`,
    umowa?.number ? `umowa ${esc(umowa.number)}` : null,
    umowa?.valid_until ? `do ${formatData(umowa.valid_until)}` : 'czas nieokreślony',
  ].filter(Boolean).join(' · ');
  const platnosc = opisPlatnosci(n, s.indeksy.konta);
  const promo = trwa ? promocjaNajmu(stawki, dzien) : null;
  const edycja = s.ui.edycja;
  const wypowiedzenie = trwa && !n.notice_end_on && n.end_on ? `<span class="zawijaj"><span class="status czesciowo">kończy się</span>
    najem do <strong>${formatData(n.end_on)}</strong></span>` : trwa && n.notice_end_on ? `<span class="zawijaj"><span class="status czesciowo">wypowiedziana</span>
    ${n.notice_given_on ? `złożona ${formatData(n.notice_given_on)} · ` : ''}koniec najmu <strong>${formatData(n.notice_end_on)}</strong>${
  edycja ? ` <button type="button" class="link-btn maly" data-akcja="cofnij-wypowiedzenie" data-id="${esc(n.id)}">cofnij</button>` : ''}</span>` : '';

  return `<li class="najem">
    <div class="wiersz">
      <div class="glowna"><strong class="mono"><a href="#/jednostki/${encodeURIComponent(n.unit_id)}">${esc(j?.code ?? '?')}</a></strong>
        <span>${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'}</span>
        <span class="zawijaj">${szczegoly}</span>
        ${wypowiedzenie}
        <span class="zawijaj">płaci: ${esc(platnosc)}${edycja && trwa && platnosc.endsWith('nieustalone')
    ? ` <a class="maly" href="#/najmy/${id}/platnosc">ustal</a>` : ''}</span>
        ${promo ? `<span class="znacznik promocja">${promo.do ? `promocja do ${formatData(promo.do)}` : 'promocja'}</span>` : ''}
        ${koniec ? `<span class="znacznik${koniec.wygasla ? ' pilne' : ''}">${esc(koniec.wygasla
          ? `Umowa wygasła ${formatData(umowa.valid_until)}: przedłuż albo zakończ najem` : koniec.tekst)}</span>` : ''}</div>
      <div class="prawa kwota">${stawka != null ? formatZl(stawka) : '—'}</div>
    </div>
    ${stawki.length > 1 ? `<details class="historia-stawek"><summary>Historia stawek (${stawki.length})</summary>
      <ul>${stawki.map((st) => `<li><span>od ${formatData(st.valid_from)}${st.reason ? ` · ${esc(st.reason)}` : ''}</span>
        <span class="kwota">${formatZl(st.amount_gr)}</span></li>`).join('')}</ul></details>` : ''}
    ${edycja ? `<div class="akcje-wiersza">
      <a href="#/najmy/${id}/stawka">Zmień stawkę</a>
      <a href="#/najmy/${id}/promocja">Promocja</a>
      <a href="#/najmy/${id}/korekta?tryb=kwota">Kwota 1. okresu</a>
      <a href="#/najmy/${id}/korekta">Korekta należności</a>
      <a href="#/najmy/${id}/platnosc">Gdzie płaci</a>
      ${trwa ? `<a href="#/najmy/${id}/koniec">Zakończ najem</a>` : ''}
    </div>` : ''}
  </li>`;
}

const STATUS_KAUCJI = (k) => {
  if (k.przyjeta === 0) return '';
  if (k.saldo === k.przyjeta) return 'u wynajmującego';
  if (k.saldo === 0) return k.zatrzymana ? (k.zwrocona ? 'rozliczona' : 'zatrzymana') : 'zwrócona';
  return `rozliczona w części, zostało ${formatZl(k.saldo)}`;
};

/** Umowy klienta, do których można dopisać kaucję: niezarchiwizowane, z co najmniej jednym najmem innym niż box. */
function umowyNaKaucje(s, klient) {
  const najmy = s.indeksy.najmyKlienta.get(klient.id) ?? [];
  return [...s.indeksy.umowy.values()].filter((u) => u.client_id === klient.id && !u.archived
    && najmy.some((n) => n.contract_id === u.id && !bezKaucji(s.indeksy.jednostki.get(n.unit_id)?.type)));
}

/** „Umowa 12/2026 (G-03, K-01)” */
function nazwaUmowy(s, u) {
  const kody = (s.indeksy.najmyKlienta.get(u.client_id) ?? []).filter((n) => n.contract_id === u.id)
    .map((n) => s.indeksy.jednostki.get(n.unit_id)?.code ?? '?').sort(porownajKody);
  return `${u.number ? `Umowa ${u.number}` : 'Umowa bez numeru'}${kody.length ? ` (${kody.join(', ')})` : ''}`;
}

function kaucje(s, klient, umowy) {
  const forma = { gotowka: 'gotówką', przelew: 'przelewem' };
  const wiersze = umowy.map((u) => {
    const ruchy = s.dane.deposits.filter((d) => d.contract_id === u.id).sort((a, b) => a.on_date.localeCompare(b.on_date));
    if (!ruchy.length) return '';
    const suma = (rodzaj) => ruchy.filter((d) => d.kind === rodzaj).reduce((x, d) => x + d.amount_gr, 0);
    const k = { przyjeta: suma('przyjecie'), zwrocona: suma('zwrot'), zatrzymana: suma('zatrzymanie'),
      saldo: saldoKaucji(ruchy, u.id).saldoGr };
    return `<li><div class="wiersz"><div class="glowna">
        <strong>${esc(nazwaUmowy(s, u))}</strong>
        ${ruchy.map((d) => `<span class="zawijaj">${{ przyjecie: 'Przyjęto', zwrot: 'Zwrócono', zatrzymanie: 'Zatrzymano' }[d.kind]}
          ${formatZl(d.amount_gr)} ${d.kind !== 'zatrzymanie' ? forma[d.method] ?? '' : ''} · ${formatData(d.on_date)}${
  d.reason ? ` · ${esc(d.reason)}` : ''}${s.ui.edycja && d.kind === 'przyjecie' && !d.payment_id
  ? ` · <a href="#/klienci/${encodeURIComponent(klient.id)}/kaucja?wpis=${encodeURIComponent(d.id)}">popraw / usuń</a>` : ''}</span>`).join('')}</div>
      <div class="prawa"><div class="kwota">${formatZl(k.przyjeta)}</div><div class="maly">${STATUS_KAUCJI(k)}</div></div>
    </div></li>`;
  }).join('');
  const mozna = umowyNaKaucje(s, klient).length > 0;
  const dodaj = mozna && !klient.archived ? `<div class="pasek-akcji">${przycisk({ tekst: 'Dodaj kaucję',
    href: `#/klienci/${encodeURIComponent(klient.id)}/kaucja`, drugi: true, ikona: 'plus' })}</div>` : '';
  const tylkoBoxy = !mozna && (s.indeksy.najmyKlienta.get(klient.id) ?? []).length > 0;
  if (!wiersze) return `<p class="wyciszony">${tylkoBoxy ? 'Boxy wynajmujemy bez kaucji.' : 'Brak kaucji.'}</p>${dodaj}`;
  return `<ul class="lista">${wiersze}</ul>${dodaj}
    <p class="podpowiedz">Zwrot albo zatrzymanie kaucji wpisujesz przy zakończeniu ostatniego najmu w umowie.</p>`;
}

/** Formularz „Dodaj kaucję” – przyjęcie kaucji do istniejącej umowy (gotówką albo przelewem). */
function formularzKaucji(s, klient) {
  const umowy = umowyNaKaucje(s, klient);
  const poprawiany = kaucjaDoPoprawy(s, klient);
  if (poprawiany && !umowy.some((u) => u.id === poprawiany.contract_id)) umowy.push(s.indeksy.umowy.get(poprawiany.contract_id));
  const wstecz = `#/klienci/${encodeURIComponent(klient.id)}`;
  if (!umowy.length) {
    return pustyStan('Ten klient nie ma umowy, do której można dopisać kaucję (boxy są bez kaucji).',
      [{ tekst: 'Wróć do klienta', href: wstecz }]);
  }
  const wpis = kaucjaDoPoprawy(s, klient);
  const f = stanFormularza(s, `klienci/${klient.id}/kaucja?${wpis?.id ?? ''}`, () => (wpis
    ? { contract_id: wpis.contract_id, method: wpis.method, on_date: wpis.on_date, amount_gr: kwotaDoPola(wpis.amount_gr) }
    : { contract_id: umowy.length === 1 ? umowy[0].id : '', method: 'gotowka', on_date: dzisiaj() }));
  const usuwanie = !wpis ? '' : !f.potwierdzUsuniecie
    ? '<p><button type="button" class="link-btn" data-akcja="usun-kaucje">Usuń ten wpis kaucji</button></p>'
    : `<section class="karta" role="alert" aria-labelledby="usun-kaucje-tytul">
      <h2 id="usun-kaucje-tytul">Usunąć wpis kaucji?</h2>
      <p>Przyjęcie <span class="kwota">${formatZl(wpis.amount_gr)}</span> z ${formatData(wpis.on_date)}. Tego nie da się cofnąć.</p>
      <div class="pasek-akcji">
        <button type="button" class="przycisk" data-akcja="usun-kaucje-tak"${f.trwa ? ' disabled' : ''}>Usuń wpis</button>
        <button type="button" class="przycisk drugi" data-akcja="usun-kaucje-nie">Nie usuwaj</button>
      </div></section>`;
  return formularz(f, {
    nazwa: 'kaucja', przycisk: wpis ? 'Zapisz zmiany' : 'Zapisz kaucję', anuluj: wstecz,
    uwaga: 'Kaucja nie jest przychodem (Z26). Kaucję wpłaconą przelewem, który jest już w wyciągu, oznacza się przy przypisaniu przelewu – nie dopisuj jej tu drugi raz.',
    tresc: `
      ${wybor(f, { nazwa: 'contract_id', etykieta: 'Umowa', wymagane: true, pusta: 'Wybierz umowę…',
    opcje: umowy.map((u) => ({ wartosc: u.id, tekst: nazwaUmowy(s, u) })) })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota kaucji (zł)', typ: 'kwota', wymagane: true })}
        ${pole(f, { nazwa: 'on_date', etykieta: 'Data przyjęcia', typ: 'date', wymagane: true })}
      </div>
      ${opcje(f, { nazwa: 'method', legenda: 'Forma', opcje: [
    { wartosc: 'gotowka', tekst: 'Gotówka' }, { wartosc: 'przelew', tekst: 'Przelew' }] })}`,
  }) + usuwanie;
}

/** Wpis przyjęcia kaucji z adresu ?wpis=<id> – tylko dopisany ręcznie (bez powiązanego przelewu). */
function kaucjaDoPoprawy(s, klient) {
  const id = s.ui.zapytanie.wpis;
  if (!id) return null;
  const d = s.dane.deposits.find((x) => x.id === id && x.kind === 'przyjecie' && !x.payment_id);
  return d && s.indeksy.umowy.get(d.contract_id)?.client_id === klient.id ? d : null;
}

function dokumenty(umowy) {
  if (!umowy.length) return '<p class="wyciszony">Brak umów.</p>';
  return `<ul class="lista">${umowy.map((u) => `<li><div class="wiersz">
    <div class="glowna"><strong>${u.number ? `Umowa ${esc(u.number)}` : 'Umowa bez numeru'}</strong>
      <span class="zawijaj">${u.signed_on ? `podpisana ${formatData(u.signed_on)}` : 'data podpisania nieznana'}${
  u.valid_until ? ` · do ${formatData(u.valid_until)}` : ' · czas nieokreślony'}${u.notice_period ? ` · wypowiedzenie ${esc(u.notice_period)}` : ''}</span></div>
    <div class="prawa akcje-pliku">
      ${u.pdf_path ? `<button type="button" class="link-btn" data-akcja="pdf" data-sciezka="${esc(u.pdf_path)}">Otwórz PDF</button>` : ''}
      <label class="link-btn plik-btn">${u.pdf_path ? 'Zmień PDF' : 'Dodaj PDF'}
        <input type="file" accept="application/pdf,.pdf" class="sr-only" data-zmiana="pdf-umowy" data-umowa="${esc(u.id)}"></label>
    </div></div></li>`).join('')}</ul>`;
}

/** Zapamiętani płatnicy klienta (5.2) – rachunki i nazwy, po których wpłaty przypisują się same. */
function platnicy(s, klient) {
  const lista = s.dane.payers.filter((p) => p.client_id === klient.id);
  if (!lista.length) {
    return '<p class="wyciszony">Brak. Płatnik zapamiętuje się przy ręcznym przypisaniu wpłaty.</p>';
  }
  return `<ul class="lista">${lista.map((p) => `<li><div class="wiersz">
    <div class="glowna"><strong class="${p.account ? 'mono' : ''}">${esc(p.account ? formatRachunek(p.account) : p.name_key)}</strong>
      <span>${p.account ? 'rachunek' : 'nazwa nadawcy'}${p.label ? ` · ${esc(p.label)}` : ''}</span></div>
    ${s.ui.edycja ? `<div class="prawa"><button type="button" class="link-btn" data-akcja="usun-platnika" data-id="${esc(p.id)}"
      aria-label="Usuń płatnika ${esc(p.account ? `rachunek …${p.account.slice(-4)}` : p.name_key)}">Usuń</button></div>` : ''}
  </div></li>`).join('')}</ul>`;
}

function saldo(s, klient, r, najmy, dzien) {
  if (!r) return '';
  const zalega = r.zalegloscGr > 0;
  const glowna = zalega
    ? `<p><span class="kwota duza">${formatZl(-r.zalegloscGr)}</span>
        <span class="status ${r.dluznik ? 'zalega' : 'czesciowo'}">zaległość · ${r.dniPoTerminie} ${r.dniPoTerminie === 1 ? 'dzień' : 'dni'} po terminie</span></p>`
    : `<p><span class="kwota duza">${r.saldoGr > 0 ? '+' : ''}${formatZl(r.saldoGr)}</span>
        <span class="status ok">${r.saldoGr > 0 ? 'nadpłata' : 'rozliczony'}</span></p>`;
  const oplacone = najmy.filter((n) => !najemZakonczony(n, dzien)).map((n) => {
    const kod = s.indeksy.jednostki.get(n.unit_id)?.code ?? '?';
    const data = r.oplaconeDo.get(n.id);
    return `<dt class="mono">${esc(kod)}</dt><dd>${data ? `opłacone do ${formatData(data)}` : '<span class="wyciszony">nic nieopłacone</span>'}</dd>`;
  }).join('');
  const t = pokazTerminowosc() ? wynikTerminowosci(s, r) : null;
  return `${glowna}
    ${t ? `<p class="maly">Terminowość: <strong>${esc(t.etykieta)}</strong></p>` : ''}
    ${oplacone ? `<dl class="opis-pol">${oplacone}</dl>` : ''}
    <p class="podpowiedz">Ostatnia wpłata: ${r.ostatniaWplata ? formatData(r.ostatniaWplata) : 'brak'} ·
      <a href="#/wplaty/gotowka?klient=${encodeURIComponent(klient.id)}">dodaj wpłatę</a>${zalega
    ? ` · <a href="#/klienci/${encodeURIComponent(klient.id)}/notatka?rodzaj=obietnica">zapisz obietnicę zapłaty</a>
      · <a href="#/klienci/${encodeURIComponent(klient.id)}/przypomnienie">przypomnienie o płatności</a>` : ''}</p>`;
}

// ---------------------------------------------------------------------
// Kartoteka rozrachunków i terminowość (8.5)
// ---------------------------------------------------------------------

function wierszeKartoteki(s, klient, r) {
  const u = ustawienia(s);
  const wplaty = s.dane.payments.filter((w) => w.client_id === klient.id && w.kind === 'czynsz');
  return kartoteka({ pozycje: r.pozycje, wplaty, saldoOtwarcia: klient.opening_balance_gr ?? 0,
    dataStart: u.data_start, dzis: dzisiaj() });
}

const kwotaLubNic = (gr) => (gr ? formatZl(gr) : '');

function sekcjaKartoteki(s, klient, r) {
  const wszystkie = wierszeKartoteki(s, klient, r);
  if (!wszystkie.length) return '<p class="wyciszony">Brak należności i wpłat.</p>';
  const lata = [...new Set(wszystkie.map((w) => w.data.slice(0, 4)))].sort();
  const rok = lata.includes(s.ui.kartotekaRok) ? s.ui.kartotekaRok : lata.at(-1);
  const wRoku = wszystkie.filter((w) => w.data.startsWith(rok));
  const przed = wszystkie.filter((w) => w.data < `${rok}-01-01`).at(-1)?.saldoGr;
  const przyciski = lata.length > 1 ? `<div class="filtry" role="group" aria-label="Rok">${lata.map((y) =>
    `<button type="button" data-akcja="rok-kartoteki" data-wartosc="${y}" aria-pressed="${y === rok}">${y}</button>`).join('')}</div>` : '';
  const saldoTekst = (gr) => `<span class="${gr < 0 ? 'status zalega' : ''}">${gr > 0 ? '+' : ''}${formatZl(gr)}</span>`;
  return `${przyciski}
    <div class="tabela-przewijana"><table class="tabela">
      <thead><tr><th scope="col">Data</th><th scope="col">Opis</th><th scope="col" class="kwota">Winien</th>
        <th scope="col" class="kwota">Ma</th><th scope="col" class="kwota">Saldo</th></tr></thead>
      <tbody>
        ${przed != null ? `<tr><td></td><td class="wyciszony">Saldo na początek ${rok}</td><td></td><td></td><td class="kwota">${saldoTekst(przed)}</td></tr>` : ''}
        ${wRoku.map((w) => `<tr><td class="mono">${formatData(w.data)}</td><td>${esc(w.opis)}</td>
          <td class="kwota">${kwotaLubNic(w.winienGr)}</td><td class="kwota">${kwotaLubNic(w.maGr)}</td>
          <td class="kwota">${saldoTekst(w.saldoGr)}</td></tr>`).join('')}
      </tbody></table></div>
    <button type="button" class="link-btn" data-akcja="csv-kartoteki" data-rok="${rok}">Pobierz CSV (${rok})</button>`;
}

const STANY_MIESIECY = {
  ok: 'terminowo', spoznienie: 'spóźnienie', 'brak-zaplaty': 'brak zapłaty', brak: 'brak należności', czeka: 'termin jeszcze nie minął',
};

function wynikTerminowosci(s, r) {
  const u = ustawienia(s);
  return terminowosc(r.pozycje, { dzis: dzisiaj(), tolerancja: u.tolerance_days,
    miesiecy: u.punctuality_months ?? 12, progi: PROGI_TERMINOWOSCI });
}

function sekcjaTerminowosci(t) {
  const kwadraty = t.miesiace.map((m) => {
    const opisM = `${etykietaMiesiaca(m.klucz)}: ${STANY_MIESIECY[m.stan]}${m.dni && m.stan !== 'ok' ? ` (${m.dni} dni)` : ''}`;
    return `<li class="kwadrat ${m.stan}" title="${esc(opisM)}"><span class="sr-only">${esc(opisM)}</span></li>`;
  }).join('');
  return `<ul class="terminowosc" aria-label="Terminowość w ostatnich miesiącach">${kwadraty}</ul>
    <p><strong>${esc(t.etykieta)}</strong>${t.procent != null ? ` · ${Math.round(t.procent * 100)}% terminowo z ${t.liczba}` : ''}${
  t.srednieOpoznienie ? ` · średnie opóźnienie ${t.srednieOpoznienie} dni` : ''}</p>
    <p class="podpowiedz">Zielony – terminowo, bursztynowy – spóźnienie, czerwony – brak zapłaty, szary – brak należności.</p>`;
}

// ---------------------------------------------------------------------
// Notatki i historia kontaktu (8.5), obietnice zapłaty (5.4)
// ---------------------------------------------------------------------


function sekcjaNotatek(s, klient) {
  const notatki = s.dane.client_notes.filter((n) => n.client_id === klient.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dodaj = przycisk({ tekst: 'Dodaj notatkę', href: `#/klienci/${encodeURIComponent(klient.id)}/notatka`, drugi: true, ikona: 'plus' });
  if (!notatki.length) return `<p class="wyciszony">Brak notatek.</p>${dodaj}`;
  const dzis = dzisiaj();
  return `<ul class="lista">${notatki.map((n) => {
    let termin = '';
    if (n.promised_on) {
      const klasa = n.done_at ? 'ok' : n.promised_on < dzis ? 'zalega' : 'czesciowo';
      const tekst = n.done_at ? `zrobione ${formatData(dataZeZnacznika(n.done_at))}`
        : n.kind === 'obietnica' ? `obiecał${n.promised_gr ? ` ${formatZl(n.promised_gr)}` : ''} do ${formatData(n.promised_on)}`
          : `termin ${formatData(n.promised_on)} · ${KTO[n.task_owner ?? 'ja'].toLowerCase()}`;
      termin = `<span class="status ${klasa}">${tekst}</span>`;
    }
    const obietnica = termin;
    return `<li><div class="wiersz">
      <div class="glowna"><strong>${esc(RODZAJE_NOTATEK[n.kind] ?? n.kind)}</strong>
        <span>${formatData(dataZeZnacznika(n.created_at))}${obietnica ? ` · ${obietnica}` : ''}</span>
        <span class="tekst-notatki">${esc(n.body)}</span></div>
      <div class="prawa">${n.promised_on ? `<button type="button" class="przycisk drugi maly" data-akcja="zadanie-zrobione"
        data-id="${esc(n.id)}" data-zrobione="${n.done_at ? '' : '1'}">${n.done_at ? 'Przywróć' : 'Zrobione'}</button>` : ''}
        <button type="button" class="link-btn" data-akcja="usun-notatke" data-id="${esc(n.id)}"
        aria-label="Usuń notatkę z ${formatData(dataZeZnacznika(n.created_at))}">Usuń</button></div>
    </div></li>`;
  }).join('')}</ul>${dodaj}`;
}

function formularzNotatki(s, klient) {
  const f = stanFormularza(s, `klienci/${klient.id}/notatka`, () => {
    const obiet = s.ui.zapytanie.rodzaj === 'obietnica';
    return { kind: obiet ? 'obietnica' : 'telefon', task_owner: obiet ? 'klient' : 'ja' };
  });
  const obietnica = f.wartosci.kind === 'obietnica';
  return formularz(f, {
    nazwa: 'notatka',
    przycisk: 'Zapisz notatkę',
    anuluj: `#/klienci/${encodeURIComponent(klient.id)}`,
    tresc: `
      ${opcje(f, { nazwa: 'kind', legenda: 'Rodzaj', odswiez: true,
    opcje: Object.entries(RODZAJE_NOTATEK).map(([wartosc, tekst]) => ({ wartosc, tekst })) })}
      ${obszar(f, { nazwa: 'body', etykieta: obietnica ? 'Co ustaliliście' : 'Treść', wymagane: true, wiersze: 3, maks: 1000 })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'promised_on', etykieta: obietnica ? 'Zapłaci do' : 'Termin (opcjonalnie)', typ: 'date',
    wymagane: obietnica, odswiez: true,
    podpowiedz: obietnica ? '' : 'Z terminem notatka staje się zadaniem w zakładce „Zadania”.' })}
        ${obietnica ? pole(f, { nazwa: 'promised_gr', etykieta: 'Kwota (zł, opcjonalnie)', typ: 'kwota' }) : ''}
      </div>
      ${f.wartosci.promised_on ? opcje(f, { nazwa: 'task_owner', legenda: 'Czyje to zadanie',
    opcje: Object.entries(KTO).map(([wartosc, tekst]) => ({ wartosc, tekst: wartosc === 'ja' ? 'Moje' : 'Klienta' })) }) : ''}`,
  });
}

/** Archiwizacja (8.5): tylko bez trwających najmów i przy saldzie 0. Przywrócenie zawsze możliwe. */
function przyciskArchiwizacji(klient, najmy, r, dzien) {
  if (klient.archived) {
    return `<div class="pasek-akcji">${przycisk({ tekst: 'Przywróć klienta', akcja: 'archiwizuj', drugi: true })}</div>`;
  }
  const trwa = najmy.some((n) => !najemZakonczony(n, dzien));
  const powod = trwa ? 'ma trwający najem' : r && r.saldoGr !== 0 ? `saldo nie wynosi 0 (${formatZl(r.saldoGr)})` : null;
  return `<div class="pasek-akcji">${powod
    ? `<p class="podpowiedz">Archiwizacja niedostępna – klient ${esc(powod)}.</p>`
    : przycisk({ tekst: 'Archiwizuj klienta', akcja: 'archiwizuj', drugi: true })}</div>`;
}

/** Po zapisie nowego najmu (?nowy=<id najmu>): następne kroki – umowa do podpisania i brama. */
function dalejPoNowymNajmie(s, klient) {
  const najem = s.dane.rentals.find((n) => n.id === s.ui.zapytanie.nowy);
  if (!najem) return '';
  const id = encodeURIComponent(klient.id);
  const kod = s.indeksy.jednostki.get(najem.unit_id)?.code ?? '';
  const numer = bramaJednostki(s.indeksy.jednostki.get(najem.unit_id));
  const maDostep = (s.dane.gate_access ?? []).some((d) => d.client_id === klient.id && !d.removed_on
    && s.dane.gates?.find((b) => b.id === d.gate_id)?.numer === numer);
  const kroki = [
    `<a class="przycisk" href="#/klienci/${id}/umowa?najem=${encodeURIComponent(najem.id)}">Umowa do podpisania</a>`,
    s.dane.gates?.length && !maDostep ? `<a class="przycisk drugi" href="#/bramy/${id}?brama=${numer}">Przypisz do bramy ${numer}</a>` : '',
  ].filter(Boolean).join('');
  return `<section class="karta wyrozniona" aria-labelledby="k-dalej"><h2 id="k-dalej">Najem ${esc(kod)} zapisany – dalej</h2>
    <div class="pasek-akcji">${kroki}</div></section>`;
}

/**
 * Karta klienta – kolejność kart na sztywno (prośba 11.11): Saldo i Notatki na górze, potem Najmy, Kontakt (zwarty),
 * Terminowość (tylko gdy włączona w Ustawieniach), Kaucja, Dokumenty, Kartoteka, Płatnicy.
 * Pomysł na później: użytkownik sam ustawia kolejność i wielkość kart (zapis w dokumencie „pomysly-na-pozniej”).
 */
function karta(s, klient) {
  const dzien = dzisiaj();
  const r = rozliczeniaKlientow(s).get(klient.id);
  const najmy = [...(s.indeksy.najmyKlienta.get(klient.id) ?? [])]
    .sort((a, b) => (a.end_on != null) - (b.end_on != null) || b.start_on.localeCompare(a.start_on));
  const umowy = [...s.indeksy.umowy.values()].filter((u) => u.client_id === klient.id)
    .sort((a, b) => (b.signed_on ?? '').localeCompare(a.signed_on ?? ''));
  // Kontakt: najczęściej potrzebne pola od razu, reszta (NIP, dokument, PESEL, saldo otwarcia) po rozwinięciu.
  const kontaktGlowny = [
    opis('Telefon', klient.phone && `<a href="tel:${esc(klient.phone.replace(/[^\d+]/g, ''))}">${esc(klient.phone)}</a>`),
    opis('E-mail', klient.email && `<a href="mailto:${esc(klient.email)}">${esc(klient.email)}</a>`),
    opis('Adres', klient.address && esc(klient.address)),
    opis('Osoba kontaktowa', klient.contact_person && esc(klient.contact_person)),
  ].join('');
  const kontaktDodatkowy = [
    opis('NIP', klient.nip && `<span class="mono">${esc(klient.nip)}</span>`),
    opis(esc(TYPY_DOKUMENTU[klient.doc_type] ?? 'Dokument'), klient.doc_number && `<span class="mono">${esc(klient.doc_number)}</span>`),
    opis('PESEL', klient.pesel && `<span class="mono">${esc(klient.pesel)}</span>`),
    opis(`Saldo otwarcia (${formatData(ustawienia(s).data_start)})`, klient.opening_balance_gr
      ? `<span class="kwota">${formatZl(klient.opening_balance_gr)}</span>` : ''),
  ].join('');
  const kontakt = kontaktGlowny + kontaktDodatkowy;   // tryb „Edytuj” pokazuje wszystko
  const id = encodeURIComponent(klient.id);
  if (s.ui.edycja) return ustawieniaKlienta(s, klient, { najmy, umowy, kontakt, r, dzien });

  return `
    <div class="pasek-akcji">
      ${przycisk({ tekst: 'Wpłata', href: `#/wplaty/gotowka?klient=${id}`, ikona: 'plus' })}
      ${najmyDoUmowy(s, klient.id, dzien).length ? przycisk({ tekst: 'Umowa do podpisania', href: `#/klienci/${id}/umowa`, drugi: true }) : ''}
      ${najmy.some((n) => najemTrwa(n, dzien) && !n.end_on && !n.notice_end_on)
    ? przycisk({ tekst: 'Wypowiedz umowę', href: `#/klienci/${id}/wypowiedzenie`, drugi: true }) : ''}
      ${przyciskEdycji(s)}
    </div>
    ${klient.archived ? '<p class="baner">Klient jest zarchiwizowany.</p>' : ''}
    ${dalejPoNowymNajmie(s, klient)}
    <div class="siatka">
      <section class="karta" aria-labelledby="k-saldo"><h2 id="k-saldo">Saldo</h2>${ostrzezenieKonta(s, klient, dzien)}${saldo(s, klient, r, najmy, dzien)}</section>
      <section class="karta" aria-labelledby="k-notatki"><h2 id="k-notatki">Notatki i historia kontaktu</h2>
        ${sekcjaNotatek(s, klient)}</section>
      <section class="karta" aria-labelledby="k-najmy"><h2 id="k-najmy">Najmy</h2>
        ${najmy.length ? `<ul class="lista">${najmy.map((n) => wierszNajmu(s, n, dzien)).join('')}</ul>`
          : '<p class="wyciszony">Brak najmów.</p>'}</section>
      ${kartaBramKlienta(s, klient)}
      <section class="karta zwarta" aria-labelledby="k-kontakt"><h2 id="k-kontakt">Kontakt</h2>
        ${kontaktGlowny ? `<dl class="opis-pol">${kontaktGlowny}</dl>` : '<p class="wyciszony">Brak danych kontaktowych.</p>'}
        ${kontaktDodatkowy ? `<details class="wiecej-danych"><summary>Więcej danych</summary><dl class="opis-pol">${kontaktDodatkowy}</dl></details>` : ''}
        ${klient.note ? `<p class="notatka">${esc(klient.note)}</p>` : ''}</section>
      ${r && pokazTerminowosc() ? `<section class="karta" aria-labelledby="k-terminowosc"><h2 id="k-terminowosc">Terminowość</h2>
        ${sekcjaTerminowosci(wynikTerminowosci(s, r))}</section>` : ''}
      <section class="karta" aria-labelledby="k-kaucja"><h2 id="k-kaucja">Kaucja</h2>${kaucje(s, klient, umowy)}</section>
      <section class="karta" aria-labelledby="k-dokumenty"><h2 id="k-dokumenty">Dokumenty</h2>${dokumenty(umowy)}</section>
      ${r ? `<section class="karta szeroka" aria-labelledby="k-kartoteka"><h2 id="k-kartoteka">Kartoteka rozrachunków</h2>
        ${sekcjaKartoteki(s, klient, r)}</section>` : ''}
      <section class="karta" aria-labelledby="k-platnicy"><h2 id="k-platnicy">Płatnicy</h2>${platnicy(s, klient)}</section>
    </div>
    ${s.ui.edycja ? przyciskArchiwizacji(klient, najmy, r, dzien) : ''}`;
}

// ---------------------------------------------------------------------
// Tryb „Edytuj”: zwarte „Ustawienia klienta” (prośba 11.11) – rozwijane grupy zamiast pełnej karty.
// Saldo, terminowość, kartoteka i notatki są tylko w zwykłym widoku.
// ---------------------------------------------------------------------

function ustawieniaKlienta(s, klient, { najmy, umowy, kontakt, r, dzien }) {
  const id = encodeURIComponent(klient.id);
  const daneStan = [klient.phone, klient.email, klient.nip ? `NIP ${klient.nip}` : null].filter(Boolean).map(esc).join(' · ')
    || 'brak danych kontaktowych';
  const trwajace = najmy.filter((n) => !najemZakonczony(n, dzien));
  const doWypowiedzenia = najmy.some((n) => najemTrwa(n, dzien) && !n.end_on && !n.notice_end_on);
  const ruchyKaucji = s.dane.deposits.filter((d) => umowy.some((u) => u.id === d.contract_id)).length;
  const zPdf = umowy.filter((u) => u.pdf_path).length;
  const platnicyKlienta = s.dane.payers.filter((p) => p.client_id === klient.id).length;

  return `
    <div class="pasek-akcji">${przyciskEdycji(s)}</div>
    ${klient.archived ? '<p class="baner">Klient jest zarchiwizowany.</p>' : ''}
    <section class="karta ustawienia-klienta" aria-labelledby="k-ustawienia">
      <h2 id="k-ustawienia">Ustawienia klienta</h2>
      <p class="podpowiedz">Rozwiń grupę, żeby coś zmienić. „Gotowe” wraca do zwykłego widoku.</p>
      ${grupa('Dane klienta', daneStan, `${kontakt ? `<dl class="opis-pol">${kontakt}</dl>` : ''}
        ${klient.note ? `<p class="notatka">${esc(klient.note)}</p>` : ''}
        ${menu([pozycja({ tekst: 'Edytuj dane klienta', href: `#/klienci/${id}/edycja` })])}`)}
      <h3 class="naglowek-grup">Najmy</h3>
      ${najmy.map((n) => grupaNajmu(s, n, dzien)).join('')}
      ${menu([
    klient.archived ? null : pozycja({ tekst: '+ Nowy najem', href: `#/najmy/nowy?klient=${id}` }),
    doWypowiedzenia ? pozycja({ tekst: 'Wypowiedz umowę', href: `#/klienci/${id}/wypowiedzenie` }) : null,
  ])}
      <h3 class="naglowek-grup">Pozostałe</h3>
      ${grupa('Kaucja', ruchyKaucji ? `${ruchyKaucji} ${ruchyKaucji === 1 ? 'wpis' : ruchyKaucji < 5 ? 'wpisy' : 'wpisów'}`
    : umowyNaKaucje(s, klient).length ? 'brak' : 'boxy bez kaucji', kaucje(s, klient, umowy))}
      ${grupa('Dokumenty', umowy.length ? `umowy: ${umowy.length} · z PDF: ${zPdf}` : 'brak umów', dokumenty(umowy))}
      ${grupa('Płatnicy', platnicyKlienta ? `zapamiętani: ${platnicyKlienta}` : 'brak', platnicy(s, klient))}
      ${grupa(klient.archived ? 'Przywróć klienta' : 'Archiwizacja', klient.archived ? 'zarchiwizowany'
    : trwajace.length ? 'niedostępna – trwa najem' : 'możliwa przy saldzie 0', przyciskArchiwizacji(klient, najmy, r, dzien))}
    </section>`;
}

// ---------------------------------------------------------------------
// Wypowiedzenie najmu (prośba 11.11): data złożenia i koniec najmu → oznaczenie przy najmie + zadanie „Zadania”
// ---------------------------------------------------------------------

/** Trwające najmy klienta bez daty końca – te można wypowiedzieć. */
function najmyDoWypowiedzenia(s, klient) {
  const dzien = dzisiaj();
  return (s.indeksy.najmyKlienta.get(klient.id) ?? []).filter((n) => !n.end_on && !najemZakonczony(n, dzien))
    .sort((a, b) => porownajKody(s.indeksy.jednostki.get(a.unit_id)?.code ?? '', s.indeksy.jednostki.get(b.unit_id)?.code ?? ''));
}

function formularzWypowiedzenia(s, klient) {
  const najmy = najmyDoWypowiedzenia(s, klient);
  if (!najmy.length) return pustyStan('Ten klient nie ma trwających najmów.', [{ tekst: 'Wróć', href: `#/klienci/${encodeURIComponent(klient.id)}` }]);
  const dzis = dzisiaj();
  const f = stanFormularza(s, `klienci/${klient.id}/wypowiedzenie`, () => ({
    given_on: dzis,
    end_on: dodajMiesiace(dzis, 1, 31),   // podpowiedź: koniec następnego miesiąca
    ...Object.fromEntries(najmy.map((n) => [`najem_${n.id}`, n.notice_end_on ? '' : 'on'])),
  }));
  const okres = [...s.indeksy.umowy.values()].filter((u) => u.client_id === klient.id && u.notice_period).map((u) => u.notice_period);
  return formularz(f, {
    nazwa: 'wypowiedzenie',
    przycisk: 'Zapisz wypowiedzenie',
    anuluj: `#/klienci/${encodeURIComponent(klient.id)}`,
    uwaga: 'Najem trwa do daty końca – należności liczą się dalej. W dniu końca na liście „Zadania” pojawi się przypomnienie, żeby zakończyć najem i rozliczyć kaucję.',
    tresc: `<fieldset><legend>Które jednostki</legend>
        ${najmy.map((n) => przelacznik(f, { nazwa: `najem_${n.id}`, etykieta: `${s.indeksy.jednostki.get(n.unit_id)?.code ?? '?'}${
    n.notice_end_on ? ` (już wypowiedziana do ${formatData(n.notice_end_on)})` : ''}` })).join('')}
        ${f.bledy.najmy ? `<p class="blad" role="alert">${esc(f.bledy.najmy)}</p>` : ''}</fieldset>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'given_on', etykieta: 'Data złożenia wypowiedzenia', typ: 'date', wymagane: true })}
        ${pole(f, { nazwa: 'end_on', etykieta: 'Koniec najmu', typ: 'date', wymagane: true,
    podpowiedz: okres.length ? `Okres wypowiedzenia w umowie: ${esc(okres.join(', '))}.` : 'Podpowiedź: koniec następnego miesiąca.' })}
      </div>`,
  });
}

// ---------------------------------------------------------------------
// Formularz klienta (8.6)
// ---------------------------------------------------------------------

function wartosciKlienta(k) {
  if (!k) return { kind: 'osoba' };
  return {
    kind: k.kind, name: k.name, contact_person: k.contact_person ?? '', nip: k.nip ?? '', address: k.address ?? '',
    phone: k.phone ?? '', email: k.email ?? '', note: k.note ?? '',
    doc_type: k.doc_type ?? '', doc_number: k.doc_number ?? '', pesel: k.pesel ?? '',
    opening_balance_gr: k.opening_balance_gr ? kwotaDoPola(k.opening_balance_gr) : '',
  };
}

function formularzKlienta(s, k) {
  const f = stanFormularza(s, `klienci/${s.ui.parametr}/${s.ui.akcja ?? ''}`, () => wartosciKlienta(k));
  const firma = f.wartosci.kind === 'firma';
  const dalejNajem = !k && s.ui.zapytanie.dalej === 'najem';
  return formularz(f, {
    nazwa: 'klient',
    przycisk: k ? 'Zapisz zmiany' : dalejNajem ? 'Dodaj i przejdź do najmu' : 'Dodaj klienta',
    anuluj: k ? `#/klienci/${encodeURIComponent(k.id)}` : dalejNajem ? '#/najmy/nowy' : '#/klienci',
    tresc: `
      ${opcje(f, { nazwa: 'kind', legenda: 'Rodzaj', odswiez: true,
        opcje: [{ wartosc: 'osoba', tekst: 'Osoba' }, { wartosc: 'firma', tekst: 'Firma' }] })}
      ${pole(f, { nazwa: 'name', etykieta: firma ? 'Nazwa firmy' : 'Imię i nazwisko', wymagane: true,
        atrybuty: `maxlength="80" autocomplete="off"${firma ? '' : ' autocapitalize="words"'}` })}
      ${firma ? `<div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'nip', etykieta: 'NIP', atrybuty: 'inputmode="numeric" autocomplete="off"' })}
        ${pole(f, { nazwa: 'contact_person', etykieta: 'Osoba kontaktowa', atrybuty: 'autocomplete="off"' })}</div>` : ''}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'phone', etykieta: 'Telefon', typ: 'tel', wymagane: true, podpowiedz: '9 cyfr albo z +48.', atrybuty: 'autocomplete="off"' })}
        ${pole(f, { nazwa: 'email', etykieta: 'E-mail', typ: 'email', wymagane: true, atrybuty: 'autocomplete="off"' })}
      </div>
      ${pole(f, { nazwa: 'address', etykieta: 'Adres', wymagane: true, atrybuty: 'autocomplete="off"' })}
      ${firma ? '' : `<div class="pola-w-rzedzie">
        ${wybor(f, { nazwa: 'doc_type', etykieta: 'Typ dokumentu', pusta: '—',
    opcje: Object.entries(TYPY_DOKUMENTU).map(([wartosc, tekst]) => ({ wartosc, tekst })) })}
        ${pole(f, { nazwa: 'doc_number', etykieta: 'Numer dokumentu', atrybuty: 'maxlength="30" autocomplete="off" autocapitalize="characters"' })}
      </div>
      ${pole(f, { nazwa: 'pesel', etykieta: 'PESEL', atrybuty: 'inputmode="numeric" maxlength="11" autocomplete="off"',
    podpowiedz: 'Dane osobowe – nie trafiają do eksportów CSV, ale są w kopii zapasowej.' })}`}
      ${pole(f, { nazwa: 'opening_balance_gr', etykieta: `Saldo otwarcia na ${formatData(ustawienia(s).data_start)} (zł)`, typ: 'kwota',
        podpowiedz: 'Stan rozliczeń sprzed startu danych (Z34): ujemne = zaległość, np. -300; dodatnie = nadpłata.' })}
      ${obszar(f, { nazwa: 'note', etykieta: 'Notatka', wiersze: 2 })}`,
  });
}

/** Otwiera podpisany link w nowej karcie. Okno otwierane od razu (w geście kliknięcia), adres po odpowiedzi serwera. */
async function otworzPdf(ctx, sciezka) {
  const okno = window.open('', '_blank');
  try {
    const url = await ctx.db.linkDoUmowy(sciezka);
    if (okno) {
      okno.opener = null;
      okno.location.href = url;
    } else location.assign(url);
  } catch (e) {
    okno?.close();
    ctx.toast(e.message);
  }
}

export default {
  tytul(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return 'Klienci';
    if (parametr === 'nowy') return 'Nowy klient';
    const nazwa = s.indeksy.klienci.get(parametr)?.name ?? 'Klient';
    if (akcja === 'notatka') return `Notatka: ${nazwa}`;
    if (akcja === 'wypowiedzenie') return `Wypowiedzenie: ${nazwa}`;
    if (akcja === 'kaucja') return `Kaucja: ${nazwa}`;
    if (akcja === 'umowa') return `Umowa: ${nazwa}`;
    if (akcja === 'przypomnienie') return `Przypomnienie: ${nazwa}`;
    return akcja === 'edycja' ? `Edycja: ${nazwa}` : nazwa;
  },

  wstecz(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return null;
    if (['edycja', 'notatka', 'wypowiedzenie', 'kaucja', 'umowa', 'przypomnienie'].includes(akcja)) return { href: `#/klienci/${encodeURIComponent(parametr)}`, tekst: s.indeksy.klienci.get(parametr)?.name ?? 'Klient' };
    if (parametr === 'nowy' && s.ui.zapytanie.dalej === 'najem') return { href: '#/najmy/nowy', tekst: 'Nowy najem' };
    return { href: '#/klienci', tekst: 'Klienci' };
  },

  render(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return lista(s);
    if (parametr === 'nowy') return formularzKlienta(s, null);
    const klient = s.indeksy.klienci.get(parametr);
    if (!klient) return pustyStan('Nie znaleziono klienta.', [{ tekst: 'Wróć do listy', href: '#/klienci' }]);
    if (akcja === 'notatka') return formularzNotatki(s, klient);
    if (akcja === 'wypowiedzenie') return formularzWypowiedzenia(s, klient);
    if (akcja === 'kaucja') return formularzKaucji(s, klient);
    if (akcja === 'umowa') return formularzUmowy(s, klient);
    if (akcja === 'przypomnienie') return przypomnienie(s, klient);
    return akcja === 'edycja' ? formularzKlienta(s, klient) : karta(s, klient);
  },

  akcje: {
    ...akcjeAnulowania,
    ...akcjePrzypomnienia,
    'usun-kaucje'(_el, ctx) {
      if (!ctx.state.ui.form) return;
      ctx.state.ui.form.potwierdzUsuniecie = true;
      ctx.render();
      document.getElementById('usun-kaucje-tytul')?.scrollIntoView({ block: 'center' });
    },
    'usun-kaucje-nie'(_el, ctx) {
      if (ctx.state.ui.form) ctx.state.ui.form.potwierdzUsuniecie = false;
      ctx.render();
    },
    async 'usun-kaucje-tak'(_el, ctx) {
      const s = ctx.state;
      const klient = s.indeksy.klienci.get(s.ui.parametr);
      const wpis = klient && kaucjaDoPoprawy(s, klient);
      if (!wpis) return;
      await zapisz(ctx, async () => {
        await ctx.db.usun('deposits', wpis.id);
        s.dane = { ...s.dane, deposits: s.dane.deposits.filter((d) => d.id !== wpis.id) };
        ctx.scal({});
        ctx.toast(`Usunięto wpis kaucji ${formatZl(wpis.amount_gr)}`);
        ctx.nawiguj(`klienci/${encodeURIComponent(klient.id)}`);
      });
    },
    /** Cofnięcie wypowiedzenia (tryb edycji). Zadanie na liście zostaje – można je odhaczyć albo usunąć. */
    async 'cofnij-wypowiedzenie'(el, ctx) {
      const s = ctx.state;
      if (s.podglad || s.offline || s.zKopii) {
        ctx.toast('Zmiana wymaga połączenia z bazą.');
        return;
      }
      try {
        const n = await ctx.db.zmien('rentals', el.dataset.id, { notice_given_on: null, notice_end_on: null });
        ctx.scal({ rentals: [n] });
        ctx.toast('Cofnięto wypowiedzenie. Zadanie na liście zostało – odhacz je albo usuń.');
      } catch (e) {
        ctx.toast(e.message);
      }
    },
    'platnosc-klienci'(el, ctx) {
      ctx.state.ui.platnoscKlientow = el.dataset.wartosc;
      ctx.render();
    },
    'sort-klienci'(el, ctx) {
      ctx.state.ui.sortKlienci = el.dataset.wartosc;
      ctx.render();
    },
    async archiwizuj(_el, ctx) {
      const klient = ctx.state.indeksy.klienci.get(ctx.state.ui.parametr);
      if (!klient) return;
      try {
        const k = await ctx.db.zmien('clients', klient.id, { archived: !klient.archived });
        ctx.scal({ clients: [k] });
        ctx.toast(k.archived ? `Zarchiwizowano: ${k.name}` : `Przywrócono: ${k.name}`);
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
    async 'usun-notatke'(el, ctx) {
      const id = el.dataset.id;
      try {
        await ctx.db.usun('client_notes', id);
        ctx.state.dane = { ...ctx.state.dane, client_notes: ctx.state.dane.client_notes.filter((n) => n.id !== id) };
        ctx.toast('Usunięto notatkę');
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
    'rok-kartoteki'(el, ctx) {
      ctx.state.ui.kartotekaRok = el.dataset.wartosc;
      ctx.render();
    },
    'csv-kartoteki'(el, ctx) {
      const s = ctx.state;
      const klient = s.indeksy.klienci.get(s.ui.parametr);
      const r = klient && rozliczeniaKlientow(s).get(klient.id);
      if (!r) return;
      const rok = el.dataset.rok;
      const zl = (gr) => (gr ? (gr / 100).toFixed(2).replace('.', ',') : '');
      const wiersze = wierszeKartoteki(s, klient, r).filter((w) => w.data.startsWith(rok))
        .map((w) => [w.data, w.opis, zl(w.winienGr), zl(w.maGr), (w.saldoGr / 100).toFixed(2).replace('.', ',')]);
      const url = URL.createObjectURL(new Blob([doCsv(['data', 'opis', 'winien', 'ma', 'saldo'], wiersze)],
        { type: 'text/csv;charset=utf-8' }));
      const nazwa = `kartoteka_${klient.name.replace(/[^\p{L}\p{N}]+/gu, '_')}_${rok}.csv`;
      const a = Object.assign(document.createElement('a'), { href: url, download: nazwa });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    pdf(el, ctx) {
      otworzPdf(ctx, el.dataset.sciezka);
    },
    /** Usunięcie płatnika: kolejne wpłaty z tego rachunku/nazwy nie przypiszą się same. Przypisane wpłaty zostają. */
    async 'usun-platnika'(el, ctx) {
      const id = el.dataset.id;
      if (ctx.state.podglad || ctx.state.offline) {
        ctx.toast('Usuwanie wymaga połączenia z bazą.');
        return;
      }
      try {
        await ctx.db.usun('payers', id);
        ctx.state.dane = { ...ctx.state.dane, payers: ctx.state.dane.payers.filter((p) => p.id !== id) };
        ctx.toast('Usunięto płatnika. Wcześniej przypisane wpłaty zostają bez zmian.');
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
  },

  zmiany: {
    /** Dodanie albo zmiana PDF umowy z karty klienta. */
    async 'pdf-umowy'(el, ctx) {
      const plik = el.files?.[0];
      const umowa = ctx.state.indeksy.umowy.get(el.dataset.umowa);
      if (!plik || !umowa) return;
      const blad = walidujPdf(plik);
      if (blad) {
        ctx.toast(blad);
        return;
      }
      if (ctx.state.podglad || ctx.state.offline) {
        ctx.toast('Wgranie PDF wymaga połączenia z bazą.');
        return;
      }
      ctx.toast('Wgrywanie PDF…');
      try {
        const sciezka = await ctx.db.wgrajUmowe(ctx.state.uzytkownik.id, umowa.id, plik);
        ctx.scal({ contracts: [await ctx.db.zmien('contracts', umowa.id, { pdf_path: sciezka })] });
        ctx.toast('PDF umowy zapisany');
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
  },

  przyZmianie: {
    notatka(nazwa, f) {
      if (nazwa === 'kind') f.wartosci.task_owner = f.wartosci.kind === 'obietnica' ? 'klient' : 'ja';
    },
  },

  formularze: {
    ...formularzeUmowy,
    ...formularzeprzypomnienia,
    async kaucja(form, ctx) {
      const s = ctx.state;
      const klient = s.indeksy.klienci.get(s.ui.parametr);
      if (!klient) return;
      const w = wartosciFormularza(form);
      const wpis = kaucjaDoPoprawy(s, klient);
      const umowy = umowyNaKaucje(s, klient);
      if (wpis && !umowy.some((u) => u.id === wpis.contract_id)) umowy.push(s.indeksy.umowy.get(wpis.contract_id));
      const { bledy, wiersz } = walidujKaucje(w, { umowy, dzis: dzisiaj() });
      if (maBledy(ctx, w, bledy)) return;
      await zapisz(ctx, async () => {
        ctx.scal({ deposits: [wpis ? await ctx.db.zmien('deposits', wpis.id, wiersz) : await ctx.db.wstaw('deposits', wiersz)] });
        ctx.toast(wpis ? 'Zapisano zmiany kaucji' : `Zapisano kaucję ${formatZl(wiersz.amount_gr)}`);
        ctx.nawiguj(`klienci/${encodeURIComponent(klient.id)}`);
      });
    },

    async wypowiedzenie(form, ctx) {
      const s = ctx.state;
      const klient = s.indeksy.klienci.get(s.ui.parametr);
      if (!klient) return;
      const w = wartosciFormularza(form);
      const { bledy, wybrane, zmiany } = walidujWypowiedzenie(w, { najmy: najmyDoWypowiedzenia(s, klient) });
      if (maBledy(ctx, w, bledy)) return;
      const kody = wybrane.map((n) => s.indeksy.jednostki.get(n.unit_id)?.code ?? '?').join(', ');
      await zapisz(ctx, async () => {
        const najmy = [];
        for (const n of wybrane) najmy.push(await ctx.db.zmien('rentals', n.id, zmiany));
        const zadanie = await ctx.db.wstaw('client_notes', {
          client_id: klient.id, kind: 'notatka', task_owner: 'ja', promised_on: zmiany.notice_end_on,
          body: `Wypowiedzenie ${kody} (złożone ${formatData(zmiany.notice_given_on)}): koniec najmu ${
            formatData(zmiany.notice_end_on)} – zakończ najem i rozlicz kaucję.`,
        });
        ctx.scal({ rentals: najmy, client_notes: [zadanie] });
        ctx.toast(`Wypowiedzenie ${kody} – koniec ${formatData(zmiany.notice_end_on)}, dodano zadanie`);
        ctx.nawiguj(`klienci/${encodeURIComponent(klient.id)}`);
      });
    },

    async notatka(form, ctx) {
      const s = ctx.state;
      const klientId = s.ui.parametr;
      const w = wartosciFormularza(form);
      const kind = w.kind in RODZAJE_NOTATEK ? w.kind : 'notatka';
      const bledy = {};
      const body = String(w.body ?? '').trim();
      if (!body) bledy.body = 'Wpisz treść.';
      else if (body.length > 1000) bledy.body = 'Najwyżej 1000 znaków.';
      let promised_on = null;
      let promised_gr = null;
      promised_on = /^\d{4}-\d{2}-\d{2}$/.test(w.promised_on ?? '') ? w.promised_on : null;
      if (String(w.promised_on ?? '').trim() && !promised_on) bledy.promised_on = 'Nieprawidłowa data.';
      const task_owner = promised_on ? (w.task_owner === 'klient' ? 'klient' : 'ja') : null;
      if (kind === 'obietnica') {
        if (!promised_on) bledy.promised_on = 'Podaj datę.';
        if (String(w.promised_gr ?? '').trim()) {
          promised_gr = parseKwota(w.promised_gr);
          if (promised_gr == null || promised_gr <= 0) bledy.promised_gr = 'Podaj kwotę większą od zera albo zostaw puste.';
        }
      }
      if (maBledy(ctx, w, bledy)) return;
      await zapisz(ctx, async () => {
        const n = await ctx.db.wstaw('client_notes', { client_id: klientId, kind, body, promised_on, promised_gr, task_owner });
        ctx.scal({ client_notes: [n] });
        ctx.toast(promised_on ? 'Zapisano zadanie' : 'Zapisano notatkę');
        ctx.nawiguj(`klienci/${encodeURIComponent(klientId)}`);
      });
    },

    async klient(form, ctx) {
      const s = ctx.state;
      const k = s.ui.parametr === 'nowy' ? null : s.indeksy.klienci.get(s.ui.parametr);
      const w = wartosciFormularza(form);
      const { bledy, wiersz } = walidujKlienta(w, { klienci: s.dane.clients, id: k?.id ?? null, wymagajKontaktu: true });
      if (maBledy(ctx, w, bledy)) return;
      const { dalej, jednostka } = s.ui.zapytanie;

      await zapisz(ctx, async () => {
        const zapisany = k ? await ctx.db.zmien('clients', k.id, wiersz) : await ctx.db.wstaw('clients', wiersz);
        ctx.scal({ clients: [zapisany] });
        ctx.toast(k ? 'Zapisano dane klienta' : `Dodano klienta ${zapisany.name}`);
        const id = encodeURIComponent(zapisany.id);
        if (!k && dalej === 'najem') {
          ctx.nawiguj(`najmy/nowy?klient=${id}${jednostka ? `&jednostka=${encodeURIComponent(jednostka)}` : ''}`);
        } else ctx.nawiguj(`klienci/${id}`);
      });
    },
  },
};
