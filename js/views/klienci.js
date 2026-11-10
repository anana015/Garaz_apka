// Klienci (8.4), karta klienta (8.5) i formularz klienta (8.6).
// Adresy: #/klienci, #/klienci/nowy[?dalej=najem&jednostka=<id>], #/klienci/<id>, #/klienci/<id>/edycja

import { najemTrwa, najemZakonczony, stawkaNaDzien } from '../dane.js';
import {
  formularz, maBledy, obszar, opcje, pole, stanFormularza, wartosciFormularza, zapisz,
} from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, formatData, formatZl, kwotaDoPola, normalizujTekst, porownajKody,
} from '../utils.js';
import { saldoKaucji, walidujKlienta, walidujPdf } from '../walidacja.js';
import { koniecUmowy } from './jednostki.js';
import { ustawienia } from './wspolne.js';

/** Klient aktywny: niezarchiwizowany i bez najmów albo z najmem, który się nie skończył. */
function czyAktywny(klient, najmy, dzien) {
  if (klient.archived) return false;
  return najmy.length === 0 || najmy.some((n) => !najemZakonczony(n, dzien));
}

const FILTRY = {
  aktywni: { tekst: 'Aktywni', warunek: (k, najmy, d) => czyAktywny(k, najmy, d) },
  dluznicy: { tekst: 'Dłużnicy', warunek: () => false },          // krok 1c
  byli: { tekst: 'Byli', warunek: (k, najmy, d) => !czyAktywny(k, najmy, d) },
  wszyscy: { tekst: 'Wszyscy', warunek: () => true },
};

function kodyJednostek(najmy, s, dzien) {
  return najmy.filter((n) => !najemZakonczony(n, dzien))
    .map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
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

  const wiersze = s.dane.clients
    .map((k) => ({ k, najmy: s.indeksy.najmyKlienta.get(k.id) ?? [] }))
    .filter(({ k, najmy }) => FILTRY[filtr].warunek(k, najmy, dzien))
    .map(({ k, najmy }) => ({ k, kody: kodyJednostek(najmy, s, dzien) }))
    .filter(({ k, kody }) => !szukane || normalizujTekst(
      `${k.name} ${k.phone ?? ''} ${k.nip ?? ''} ${kody.join(' ')}`).includes(szukane))
    .sort((a, b) => a.k.name.localeCompare(b.k.name, 'pl'));

  let tresc;
  if (filtr === 'dluznicy') tresc = wPlanie('Lista dłużników powstanie razem z rozliczeniami – krok 1c.');
  else if (!wiersze.length) tresc = pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.' : 'Brak klientów w tym widoku.');
  else {
    tresc = `<ul class="lista">${wiersze.map(({ k, kody }) => `<li>
      <a class="wiersz" href="#/klienci/${encodeURIComponent(k.id)}">
        <div class="glowna"><strong>${esc(k.name)}</strong>
          <span>${kody.length ? kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('') : 'brak aktywnych najmów'}</span></div>
        <div class="prawa wyciszony maly">saldo: krok 1c</div>
      </a></li>`).join('')}</ul>`;
  }

  return `${akcje}
    ${filtry(Object.entries(FILTRY).map(([id, f]) => ({ id, tekst: f.tekst })), filtr, 'Grupa klientów')}
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

function karta(s, klient) {
  const dzien = dzisiaj();
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
      ${przycisk({ tekst: 'Edytuj dane', href: `#/klienci/${id}/edycja`, drugi: true })}
    </div>
    <div class="siatka">
      <section class="karta" aria-labelledby="k-kontakt"><h2 id="k-kontakt">Kontakt</h2>
        ${kontakt ? `<dl class="opis-pol">${kontakt}</dl>` : '<p class="wyciszony">Brak danych kontaktowych.</p>'}
        ${klient.note ? `<p class="notatka">${esc(klient.note)}</p>` : ''}</section>
      <section class="karta" aria-labelledby="k-najmy"><h2 id="k-najmy">Najmy</h2>
        ${najmy.length ? `<ul class="lista">${najmy.map((n) => wierszNajmu(s, n, dzien)).join('')}</ul>`
          : '<p class="wyciszony">Brak najmów.</p>'}</section>
      <section class="karta" aria-labelledby="k-kaucja"><h2 id="k-kaucja">Kaucja</h2>${kaucje(s, umowy)}</section>
      <section class="karta" aria-labelledby="k-dokumenty"><h2 id="k-dokumenty">Dokumenty</h2>${dokumenty(umowy)}</section>
    </div>
    ${wPlanie('Saldo, kartoteka rozrachunków i terminowość – krok 1c. Płatnicy i notatki – kroki 1b–1c.')}`;
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
    return akcja === 'edycja' ? `Edycja: ${nazwa}` : nazwa;
  },

  wstecz(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return null;
    if (akcja === 'edycja') return { href: `#/klienci/${encodeURIComponent(parametr)}`, tekst: s.indeksy.klienci.get(parametr)?.name ?? 'Klient' };
    if (parametr === 'nowy' && s.ui.zapytanie.dalej === 'najem') return { href: '#/najmy/nowy', tekst: 'Nowy najem' };
    return { href: '#/klienci', tekst: 'Klienci' };
  },

  render(s) {
    const { parametr, akcja } = s.ui;
    if (!parametr) return lista(s);
    if (parametr === 'nowy') return formularzKlienta(s, null);
    const klient = s.indeksy.klienci.get(parametr);
    if (!klient) return pustyStan('Nie znaleziono klienta.', [{ tekst: 'Wróć do listy', href: '#/klienci' }]);
    return akcja === 'edycja' ? formularzKlienta(s, klient) : karta(s, klient);
  },

  akcje: {
    pdf(el, ctx) {
      otworzPdf(ctx, el.dataset.sciezka);
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

  formularze: {
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
