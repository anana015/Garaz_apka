// Klienci (8.4), karta klienta (8.5) i formularz klienta (8.6).
// Adresy: #/klienci, #/klienci/nowy[?dalej=najem&jednostka=<id>], #/klienci/<id>, #/klienci/<id>/edycja,
// #/klienci/<id>/notatka[?rodzaj=obietnica]

import { najemTrwa, najemZakonczony, stawkaNaDzien } from '../dane.js';
import {
  formularz, maBledy, obszar, opcje, pole, stanFormularza, wartosciFormularza, zapisz,
} from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan } from '../ui.js';
import {
  dataZeZnacznika, esc, dzisiaj, etykietaMiesiaca, formatData, formatDataKrotka, formatRachunek, formatZl, kwotaDoPola, normalizujTekst, parseKwota, porownajKody,
} from '../utils.js';
import { saldoKaucji, walidujKlienta, walidujPdf } from '../walidacja.js';
import { koniecUmowy } from './jednostki.js';
import { rozliczeniaKlientow, ustawienia } from './wspolne.js';
import { PROGI_TERMINOWOSCI } from '../config.js';
import { doCsv } from '../csv.js';
import { kartoteka, terminowosc } from '../rozliczenia.js';
import { KTO, RODZAJE_NOTATEK } from '../zadania.js';

/** Klient aktywny: niezarchiwizowany i bez najmów albo z najmem, który się nie skończył. */
function czyAktywny(klient, najmy, dzien) {
  if (klient.archived) return false;
  return najmy.length === 0 || najmy.some((n) => !najemZakonczony(n, dzien));
}

const FILTRY = {
  aktywni: { tekst: 'Aktywni', warunek: (k, najmy, d) => czyAktywny(k, najmy, d) },
  dluznicy: { tekst: 'Dłużnicy', warunek: (k, najmy, d, r) => !k.archived && Boolean(r?.dluznik) },
  byli: { tekst: 'Byli', warunek: (k, najmy, d) => !czyAktywny(k, najmy, d) },
  wszyscy: { tekst: 'Wszyscy', warunek: () => true },
};

function kodyJednostek(najmy, s, dzien) {
  return najmy.filter((n) => !najemZakonczony(n, dzien))
    .map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
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

  let tresc;
  if (!wiersze.length) {
    tresc = pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.'
      : filtr === 'dluznicy' ? 'Nikt nie zalega.' : 'Brak klientów w tym widoku.');
  } else {
    tresc = `<ul class="lista">${wiersze.map(({ k, r, t: term, kody }) => `<li>
      <a class="wiersz" href="#/klienci/${encodeURIComponent(k.id)}">
        <div class="glowna"><strong>${esc(k.name)}</strong>
          <span>${kody.length ? kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('') : 'brak aktywnych najmów'}</span></div>
        <div class="prawa">${stanSalda(r, s, k)}${term && term.etykieta !== 'Za mało danych'
    ? `<div class="maly wyciszony">${esc(term.etykieta)}</div>` : ''}</div>
      </a></li>`).join('')}</ul>`;
  }

  return `${akcje}
    ${filtry(Object.entries(FILTRY).map(([id, f]) => ({ id, tekst: f.tekst,
    liczba: id === 'dluznicy' ? liczbaDluznikow : undefined })), filtr, 'Grupa klientów')}
    ${sortowanie}
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

  return `<li class="najem">
    <div class="wiersz">
      <div class="glowna"><strong class="mono"><a href="#/jednostki/${encodeURIComponent(n.unit_id)}">${esc(j?.code ?? '?')}</a></strong>
        <span>${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'}</span>
        <span class="zawijaj">${szczegoly}</span>
        ${koniec ? `<span class="znacznik${koniec.wygasla ? ' pilne' : ''}">${esc(koniec.wygasla
          ? `Umowa wygasła ${formatData(umowa.valid_until)}: przedłuż albo zakończ najem` : koniec.tekst)}</span>` : ''}</div>
      <div class="prawa kwota">${stawka != null ? formatZl(stawka) : '—'}</div>
    </div>
    ${stawki.length > 1 ? `<details class="historia-stawek"><summary>Historia stawek (${stawki.length})</summary>
      <ul>${stawki.map((st) => `<li><span>od ${formatData(st.valid_from)}${st.reason ? ` · ${esc(st.reason)}` : ''}</span>
        <span class="kwota">${formatZl(st.amount_gr)}</span></li>`).join('')}</ul></details>` : ''}
    <div class="akcje-wiersza">
      <a href="#/najmy/${id}/stawka">Zmień stawkę</a>
      <a href="#/najmy/${id}/korekta">Korekta należności</a>
      ${trwa ? `<a href="#/najmy/${id}/koniec">Zakończ najem</a>` : ''}
    </div>
  </li>`;
}

const STATUS_KAUCJI = (k) => {
  if (k.przyjeta === 0) return '';
  if (k.saldo === k.przyjeta) return 'u wynajmującego';
  if (k.saldo === 0) return k.zatrzymana ? (k.zwrocona ? 'rozliczona' : 'zatrzymana') : 'zwrócona';
  return `rozliczona w części, zostało ${formatZl(k.saldo)}`;
};

function kaucje(s, umowy) {
  const wiersze = umowy.map((u) => {
    const ruchy = s.dane.deposits.filter((d) => d.contract_id === u.id).sort((a, b) => a.on_date.localeCompare(b.on_date));
    if (!ruchy.length) return '';
    const suma = (rodzaj) => ruchy.filter((d) => d.kind === rodzaj).reduce((x, d) => x + d.amount_gr, 0);
    const k = { przyjeta: suma('przyjecie'), zwrocona: suma('zwrot'), zatrzymana: suma('zatrzymanie'),
      saldo: saldoKaucji(ruchy, u.id).saldoGr };
    const forma = { gotowka: 'gotówką', przelew: 'przelewem' };
    return `<li><div class="wiersz"><div class="glowna">
        <strong>${u.number ? `Umowa ${esc(u.number)}` : 'Umowa bez numeru'}</strong>
        ${ruchy.map((d) => `<span class="zawijaj">${{ przyjecie: 'Przyjęto', zwrot: 'Zwrócono', zatrzymanie: 'Zatrzymano' }[d.kind]}
          ${formatZl(d.amount_gr)} ${d.kind !== 'zatrzymanie' ? forma[d.method] ?? '' : ''} · ${formatData(d.on_date)}${
  d.reason ? ` · ${esc(d.reason)}` : ''}</span>`).join('')}</div>
      <div class="prawa"><div class="kwota">${formatZl(k.przyjeta)}</div><div class="maly">${STATUS_KAUCJI(k)}</div></div>
    </div></li>`;
  }).join('');
  return wiersze ? `<ul class="lista">${wiersze}</ul>
    <p class="podpowiedz">Zwrot albo zatrzymanie kaucji wpisujesz przy zakończeniu ostatniego najmu w umowie.</p>`
    : '<p class="wyciszony">Brak kaucji.</p>';
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
    <div class="prawa"><button type="button" class="link-btn" data-akcja="usun-platnika" data-id="${esc(p.id)}"
      aria-label="Usuń płatnika ${esc(p.account ? `rachunek …${p.account.slice(-4)}` : p.name_key)}">Usuń</button></div>
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
  const t = wynikTerminowosci(s, r);
  return `${glowna}
    <p class="maly">Terminowość: <strong>${esc(t.etykieta)}</strong></p>
    ${oplacone ? `<dl class="opis-pol">${oplacone}</dl>` : ''}
    <p class="podpowiedz">Ostatnia wpłata: ${r.ostatniaWplata ? formatData(r.ostatniaWplata) : 'brak'} ·
      <a href="#/wplaty/gotowka?klient=${encodeURIComponent(klient.id)}">dodaj gotówkę</a>${zalega
    ? ` · <a href="#/klienci/${encodeURIComponent(klient.id)}/notatka?rodzaj=obietnica">zapisz obietnicę zapłaty</a>` : ''}</p>`;
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

function karta(s, klient) {
  const dzien = dzisiaj();
  const r = rozliczeniaKlientow(s).get(klient.id);
  const najmy = [...(s.indeksy.najmyKlienta.get(klient.id) ?? [])]
    .sort((a, b) => (a.end_on != null) - (b.end_on != null) || b.start_on.localeCompare(a.start_on));
  const umowy = [...s.indeksy.umowy.values()].filter((u) => u.client_id === klient.id)
    .sort((a, b) => (b.signed_on ?? '').localeCompare(a.signed_on ?? ''));
  const kontakt = [
    opis('Telefon', klient.phone && `<a href="tel:${esc(klient.phone.replace(/[^\d+]/g, ''))}">${esc(klient.phone)}</a>`),
    opis('E-mail', klient.email && `<a href="mailto:${esc(klient.email)}">${esc(klient.email)}</a>`),
    opis('NIP', klient.nip && `<span class="mono">${esc(klient.nip)}</span>`),
    opis('Adres', klient.address && esc(klient.address)),
    opis('Osoba kontaktowa', klient.contact_person && esc(klient.contact_person)),
    opis(`Saldo otwarcia (${formatData(ustawienia(s).data_start)})`, klient.opening_balance_gr
      ? `<span class="kwota">${formatZl(klient.opening_balance_gr)}</span>` : ''),
  ].join('');
  const id = encodeURIComponent(klient.id);

  return `
    <div class="pasek-akcji">
      ${przycisk({ tekst: 'Nowy najem', href: `#/najmy/nowy?klient=${id}`, ikona: 'plus' })}
      ${przycisk({ tekst: 'Wpłata gotówką', href: `#/wplaty/gotowka?klient=${id}`, drugi: true })}
      ${przycisk({ tekst: 'Edytuj dane', href: `#/klienci/${id}/edycja`, drugi: true })}
    </div>
    ${klient.archived ? '<p class="baner">Klient jest zarchiwizowany.</p>' : ''}
    <div class="siatka">
      <section class="karta" aria-labelledby="k-saldo"><h2 id="k-saldo">Saldo</h2>${saldo(s, klient, r, najmy, dzien)}</section>
      ${r ? `<section class="karta" aria-labelledby="k-terminowosc"><h2 id="k-terminowosc">Terminowość</h2>
        ${sekcjaTerminowosci(wynikTerminowosci(s, r))}</section>` : ''}
      <section class="karta" aria-labelledby="k-kontakt"><h2 id="k-kontakt">Kontakt</h2>
        ${kontakt ? `<dl class="opis-pol">${kontakt}</dl>` : '<p class="wyciszony">Brak danych kontaktowych.</p>'}
        ${klient.note ? `<p class="notatka">${esc(klient.note)}</p>` : ''}</section>
      <section class="karta" aria-labelledby="k-najmy"><h2 id="k-najmy">Najmy</h2>
        ${najmy.length ? `<ul class="lista">${najmy.map((n) => wierszNajmu(s, n, dzien)).join('')}</ul>`
          : '<p class="wyciszony">Brak najmów.</p>'}</section>
      <section class="karta" aria-labelledby="k-kaucja"><h2 id="k-kaucja">Kaucja</h2>${kaucje(s, umowy)}</section>
      <section class="karta" aria-labelledby="k-dokumenty"><h2 id="k-dokumenty">Dokumenty</h2>${dokumenty(umowy)}</section>
      ${r ? `<section class="karta szeroka" aria-labelledby="k-kartoteka"><h2 id="k-kartoteka">Kartoteka rozrachunków</h2>
        ${sekcjaKartoteki(s, klient, r)}</section>` : ''}
      <section class="karta" aria-labelledby="k-platnicy"><h2 id="k-platnicy">Płatnicy</h2>${platnicy(s, klient)}</section>
    </div>
    <section class="karta" aria-labelledby="k-notatki"><h2 id="k-notatki">Notatki i historia kontaktu</h2>
      ${sekcjaNotatek(s, klient)}</section>
    ${przyciskArchiwizacji(klient, najmy, r, dzien)}`;
}

// ---------------------------------------------------------------------
// Formularz klienta (8.6)
// ---------------------------------------------------------------------

function wartosciKlienta(k) {
  if (!k) return { kind: 'osoba' };
  return {
    kind: k.kind, name: k.name, contact_person: k.contact_person ?? '', nip: k.nip ?? '', address: k.address ?? '',
    phone: k.phone ?? '', email: k.email ?? '', note: k.note ?? '',
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
        ${pole(f, { nazwa: 'phone', etykieta: 'Telefon', typ: 'tel', podpowiedz: '9 cyfr albo z +48.', atrybuty: 'autocomplete="off"' })}
        ${pole(f, { nazwa: 'email', etykieta: 'E-mail', typ: 'email', atrybuty: 'autocomplete="off"' })}
      </div>
      ${pole(f, { nazwa: 'address', etykieta: 'Adres', atrybuty: 'autocomplete="off"' })}
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
    return akcja === 'edycja' ? `Edycja: ${nazwa}` : nazwa;
  },

  wstecz(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return null;
    if (akcja === 'edycja' || akcja === 'notatka') return { href: `#/klienci/${encodeURIComponent(parametr)}`, tekst: s.indeksy.klienci.get(parametr)?.name ?? 'Klient' };
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
    return akcja === 'edycja' ? formularzKlienta(s, klient) : karta(s, klient);
  },

  akcje: {
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
      const { bledy, wiersz } = walidujKlienta(w, { klienci: s.dane.clients, id: k?.id ?? null });
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
