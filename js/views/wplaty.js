// Wpłaty (8.2): filtry, wyszukiwanie, lista, wpłata gotówką.
// Adresy: #/wplaty, #/wplaty/gotowka[?klient=<id>], #/wplaty/przelew[?klient=<id>] (przelew wpisany ręcznie),
// #/wplaty/<id>/edycja (wpłata ręczna: gotówka albo przelew bez wyciągu),
// #/wplaty/<id>/przypisz (przelew: klient, rodzaj, „Zapamiętaj płatnika”).

import { doPrzypisania, najemZakonczony, wplataReczna } from '../dane.js';
import {
  formularz, maBledy, obszar, opcje, pole, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz,
} from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan } from '../ui.js';
import {
  esc, dzisiaj, formatZl, formatData, formatRachunek, kwotaDoPola, normalizujTekst, kluczMiesiaca, etykietaMiesiaca,
  odmiana, porownajKody,
} from '../utils.js';
import { RODZAJE_GOTOWKI, walidujGotowke } from '../walidacja.js';
import { pasujaceDoPlatnika, planZapamietania } from '../rozpoznanie.js';
import { opcjeNajmowKlienta, poleNajmu, ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const FILTRY = {
  wszystkie: { tekst: 'Wszystkie', warunek: (w, s) => kluczMiesiaca(w.booked_on) === s.ui.miesiac },
  'do-przypisania': { tekst: 'Do przypisania', warunek: (w) => w.kind === 'czynsz' && !w.client_id },
  gotowka: { tekst: 'Gotówka', warunek: (w) => w.method === 'gotowka' },
  reczne: { tekst: 'Wpisane ręcznie', warunek: (w) => w.method === 'przelew' && wplataReczna(w) },
  kaucje: { tekst: 'Kaucje', warunek: (w) => w.kind === 'kaucja' },
  pominiete: { tekst: 'Pominięte', warunek: (w) => w.kind === 'pominieta' },
};

const PUSTE = {
  wszystkie: (s) => `Brak wpłat w miesiącu ${etykietaMiesiaca(s.ui.miesiac)}.`,
  'do-przypisania': () => 'Wszystkie wpłaty są przypisane.',
  gotowka: () => 'Brak wpłat gotówkowych.',
  reczne: () => 'Brak przelewów wpisanych ręcznie.',
  kaucje: () => 'Brak kaucji wpłaconych przelewem.',
  pominiete: () => 'Brak pominiętych wpłat.',
};

const RODZAJE_PRZELEWU = { czynsz: 'Czynsz', kaucja: 'Kaucja', przychod_inny: 'Inny przychód', pominieta: 'Pomiń (nie dotyczy najmu)' };

function wiersz(w, s) {
  const klient = w.client_id ? s.indeksy.klienci.get(w.client_id) : null;
  const gotowka = w.method === 'gotowka';
  const reczna = wplataReczna(w);
  const nadawca = reczna ? (klient?.name ?? (gotowka ? 'gotówka' : 'przelew')) : (w.counterparty || '—');
  let kogo;
  if (gotowka) kogo = `gotówka${w.kind === 'przychod_inny' ? ' · inny przychód' : ''}`;
  else if (reczna) {
    kogo = `przelew wpisany ręcznie · ${esc(s.indeksy.konta.get(w.bank_account_id)?.name ?? '')}${
      w.kind === 'przychod_inny' ? ' · inny przychód' : ''}`;
  }
  else if (w.kind === 'pominieta') kogo = '<span class="status wylaczona">pominięta</span>';
  else if (w.kind === 'kaucja') kogo = `${klient ? `${esc(klient.name)} · ` : ''}kaucja`;
  else if (klient) {
    kogo = `${esc(klient.name)}${w.match_confirmed ? '' : ' <span class="status czesciowo">sprawdź</span>'}${
      w.kind === 'przychod_inny' ? ' · inny przychód' : ''}`;
  } else kogo = w.kind === 'czynsz' ? '<span class="status czesciowo">Do przypisania</span>' : '';
  if (w.rental_id && kogo) {
    const kod = s.indeksy.jednostki.get(s.dane.rentals.find((n) => n.id === w.rental_id)?.unit_id)?.code;
    if (kod) kogo += ` · za ${esc(kod)}`;
  }
  const opisWiersza = w.title || (reczna ? w.note : null);
  const tresc = `
    <div class="glowna"><strong>${esc(nadawca)}</strong>
      <span>${formatData(w.booked_on)}${opisWiersza ? ` · ${esc(opisWiersza)}` : ''}</span></div>
    <div class="prawa"><div class="kwota">${formatZl(w.amount_gr)}</div><div class="maly">${kogo}</div></div>`;
  const id = encodeURIComponent(w.id);
  const [href, etykieta] = reczna
    ? [`#/wplaty/${id}/edycja`, `Popraw wpłatę ${nadawca}`]
    : [`#/wplaty/${id}/przypisz`, `Przypisz wpłatę ${nadawca}`];
  return `<li><a class="wiersz" href="${href}" aria-label="${esc(`${etykieta}, ${formatData(w.booked_on)}, ${formatZl(w.amount_gr)}`)}">${tresc}</a></li>`;
}

function lista(s) {
  const wszystkie = s.dane.payments;
  const akcje = `<div class="pasek-akcji">
    ${przycisk({ tekst: 'Wczytaj wyciąg', href: '#/import', ikona: 'import' })}
    ${przycisk({ tekst: 'Dodaj wpłatę', href: '#/wplaty/gotowka', drugi: true, ikona: 'plus' })}</div>`;
  if (!wszystkie.length) {
    return akcje + pustyStan('Nie ma jeszcze wpłat. Wczytaj wyciąg z banku albo dodaj wpłatę gotówką.');
  }

  const filtr = s.ui.filtry.wplaty ?? 'wszystkie';
  const szukane = normalizujTekst(s.ui.szukaj.wplaty);
  const klientNazwa = (w) => (w.client_id ? s.indeksy.klienci.get(w.client_id)?.name ?? '' : '');
  const widoczne = wszystkie
    .filter((w) => FILTRY[filtr].warunek(w, s))
    .filter((w) => !szukane || normalizujTekst(
      `${w.counterparty ?? ''} ${klientNazwa(w)} ${w.title ?? ''} ${w.note ?? ''} ${formatZl(w.amount_gr, { waluta: false })}`)
      .includes(szukane))
    .sort((a, b) => b.booked_on.localeCompare(a.booked_on) || b.created_at.localeCompare(a.created_at));

  const opcjeFiltra = Object.entries(FILTRY).map(([id, f]) => ({
    id, tekst: f.tekst, liczba: id === 'do-przypisania' ? doPrzypisania(wszystkie).length : undefined,
  }));

  return `${akcje}
    ${filtry(opcjeFiltra, filtr, 'Rodzaj wpłat')}
    ${filtr === 'wszystkie' ? wyborMiesiaca(s) : ''}
    ${poleSzukaj('wplaty', s.ui.szukaj.wplaty, 'Szukaj po nadawcy, kliencie, tytule, kwocie')}
    <section class="karta">
      ${widoczne.length ? `<ul class="lista">${widoczne.map((w) => wiersz(w, s)).join('')}</ul>`
        : pustyStan(szukane ? 'Nic nie pasuje do wyszukiwania.' : PUSTE[filtr](s))}
    </section>
    ${filtr === 'do-przypisania' && widoczne.length ? '<p class="podpowiedz">Kliknij wpłatę, żeby przypisać ją do klienta.</p>' : ''}`;
}

// ---------------------------------------------------------------------
// Formularz wpłaty gotówką
// ---------------------------------------------------------------------

/** Klienci do listy wyboru: najpierw z trwającym najmem, w nazwie numery jednostek (łatwiej znaleźć). */
function opcjeKlientow(s) {
  const dzien = dzisiaj();
  return s.dane.clients
    .filter((k) => !k.archived)
    .map((k) => {
      const najmy = (s.indeksy.najmyKlienta.get(k.id) ?? []).filter((n) => !najemZakonczony(n, dzien));
      const kody = najmy.map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
      return { k, kody };
    })
    .sort((a, b) => (b.kody.length > 0) - (a.kody.length > 0) || a.k.name.localeCompare(b.k.name, 'pl'))
    .map(({ k, kody }) => ({
      wartosc: k.id,
      tekst: kody.length ? `${k.name} (${kody.join(', ')})` : k.name,
      grupa: kody.length ? 'Aktualni najemcy' : 'Pozostali klienci',
    }));
}

/** „Za jednostkę” – tylko dla czynszu klienta z co najmniej dwiema jednostkami. */
function poleZaJednostke(s, f) {
  const opcjeN = f.wartosci.client_id && (f.wartosci.kind ?? 'czynsz') === 'czynsz' ? opcjeNajmowKlienta(s, f.wartosci.client_id) : [];
  if (!opcjeN.length) return '';
  if (f.wartosci.rental_id && !opcjeN.some((o) => o.wartosc === f.wartosci.rental_id)) f.wartosci.rental_id = '';
  return wybor(f, { nazwa: 'rental_id', etykieta: 'Za jednostkę', opcje: opcjeN, pusta: 'Automatycznie – od najstarszej należności',
    podpowiedz: 'Wybrana jednostka: wpłata najpierw pokrywa jej należności (także przyszłe), nadwyżka – pozostałe.' });
}

/** Konto podpowiadane przy ręcznym przelewie: to, na które klient płaci (najem), inaczej jedyne konto. */
function kontoKlienta(s, klientId) {
  const najmy = (s.indeksy.najmyKlienta.get(klientId) ?? []).filter((n) => !najemZakonczony(n, dzisiaj()));
  const zNajmu = najmy.map((n) => n.bank_account_id).find(Boolean);
  const aktywne = s.dane.bank_accounts.filter((k) => !k.archived);
  return zNajmu ?? (aktywne.length === 1 ? aktywne[0].id : '');
}

function formularzGotowki(s, wplata) {
  const klucz = `wplaty/${s.ui.parametr}/${s.ui.akcja ?? ''}`;
  const klient = s.ui.zapytanie.klient ?? '';
  const f = stanFormularza(s, klucz, () => (wplata
    ? { booked_on: wplata.booked_on, client_id: wplata.client_id ?? '', amount_gr: kwotaDoPola(wplata.amount_gr),
      kind: wplata.kind, note: wplata.note ?? '', method: wplata.method, bank_account_id: wplata.bank_account_id ?? '',
      title: wplata.title ?? '', rental_id: wplata.rental_id ?? '' }
    : { booked_on: dzisiaj(), client_id: klient, kind: 'czynsz', method: s.ui.parametr === 'przelew' ? 'przelew' : 'gotowka',
      bank_account_id: kontoKlienta(s, klient) }));
  const przelew = f.wartosci.method === 'przelew';
  const konta = s.dane.bank_accounts.filter((k) => !k.archived || k.id === f.wartosci.bank_account_id)
    .map((k) => ({ wartosc: k.id, tekst: k.name }));
  const powrot = s.ui.zapytanie.klient ? `#/klienci/${encodeURIComponent(s.ui.zapytanie.klient)}` : '#/wplaty';
  return formularz(f, {
    nazwa: 'gotowka',
    przycisk: wplata ? 'Zapisz zmiany' : 'Dodaj wpłatę',
    drugiPrzycisk: wplata ? null : { tekst: 'Dodaj i wpisz kolejną', wartosc: 'kolejna' },
    anuluj: powrot,
    tresc: `
      ${opcje(f, { nazwa: 'method', legenda: 'Forma', odswiez: true,
    opcje: [{ wartosc: 'gotowka', tekst: 'Gotówka' }, { wartosc: 'przelew', tekst: 'Przelew' }] })}
      ${wybor(f, { nazwa: 'client_id', etykieta: 'Klient', wymagane: true, pusta: 'Wybierz klienta…', opcje: opcjeKlientow(s), odswiez: true })}
      ${poleZaJednostke(s, f)}
      ${przelew ? `${wybor(f, { nazwa: 'bank_account_id', etykieta: 'Na konto', wymagane: true, pusta: 'Wybierz konto…', opcje: konta })}
      <p class="podpowiedz">Gdy potem wczytasz wyciąg z tym przelewem, połączę go z tym wpisem (to samo konto i kwota,
        data do 5 dni różnicy) – nie policzy się podwójnie.</p>` : ''}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota (zł)', typ: 'kwota', wymagane: true })}
        ${pole(f, { nazwa: 'booked_on', etykieta: 'Data wpłaty', typ: 'date', wymagane: true,
          atrybuty: `max="${dzisiaj()}" min="${esc(ustawienia(s).data_start)}"` })}
      </div>
      ${opcje(f, { nazwa: 'kind', legenda: 'Za co',
        opcje: Object.entries(RODZAJE_GOTOWKI).map(([wartosc, tekst]) => ({ wartosc, tekst })),
        podpowiedz: 'Inny przychód (np. opłata za szkody) liczy się do przychodu, ale nie zmniejsza zaległości czynszu.' })}
      ${przelew ? pole(f, { nazwa: 'title', etykieta: 'Tytuł przelewu (opcjonalnie)' }) : ''}
      ${obszar(f, { nazwa: 'note', etykieta: 'Notatka', wiersze: 2, maks: 500 })}`,
  });
}

/** „Usuń wpłatę” przy poprawianiu wpłaty gotówką – z potwierdzeniem na ekranie (8.2, bez okienek przeglądarki). */
function usuwanieGotowki(s, w) {
  const f = s.ui.form;
  const kto = s.indeksy.klienci.get(w.client_id)?.name ?? '';
  if (!f?.potwierdzUsuniecie) {
    return `<p><button type="button" class="link-btn" data-akcja="usun-gotowke">Usuń tę wpłatę</button></p>`;
  }
  return `<section class="karta" role="alert" aria-labelledby="usun-tytul">
    <h2 id="usun-tytul">Usunąć wpłatę?</h2>
    <p><span class="kwota">${formatZl(w.amount_gr)}</span> z ${formatData(w.booked_on)}${kto ? ` – ${esc(kto)}` : ''}.
      Saldo klienta i przychód przeliczą się od razu. Tego nie da się cofnąć.</p>
    <div class="pasek-akcji">
      <button type="button" class="przycisk" data-akcja="usun-gotowke-tak"${f.trwa ? ' disabled' : ''}>Usuń wpłatę</button>
      <button type="button" class="przycisk drugi" data-akcja="usun-gotowke-nie">Nie usuwaj</button>
    </div></section>`;
}

// ---------------------------------------------------------------------
// Przypisanie przelewu do klienta (5.2: „Zapamiętaj płatnika”)
// ---------------------------------------------------------------------

/** Umowy klienta do wyboru przy kaucji: numer albo „bez numeru” + jednostki. */
function opcjeUmow(s, klientId) {
  const najmy = s.indeksy.najmyKlienta.get(klientId) ?? [];
  return [...s.indeksy.umowy.values()].filter((u) => u.client_id === klientId && !u.archived).map((u) => {
    const kody = najmy.filter((n) => n.contract_id === u.id).map((n) => s.indeksy.jednostki.get(n.unit_id)?.code)
      .filter(Boolean).sort(porownajKody);
    return { wartosc: u.id, tekst: `${u.number ? `Umowa ${u.number}` : 'Umowa bez numeru'}${kody.length ? ` (${kody.join(', ')})` : ''}` };
  });
}

function formularzPrzypisania(s, w) {
  const f = stanFormularza(s, `wplaty/${w.id}/przypisz`, () => ({
    client_id: w.client_id ?? '', kind: w.kind, contract_id: w.contract_id ?? '', zapamietaj: 'on', label: '', note: w.note ?? '',
    rental_id: w.rental_id ?? '',
  }));
  const kaucja = f.wartosci.kind === 'kaucja';
  const umowy = f.wartosci.client_id ? opcjeUmow(s, f.wartosci.client_id) : [];
  if (kaucja && umowy.length === 1 && !f.wartosci.contract_id) f.wartosci.contract_id = umowy[0].wartosc;
  const plan = f.wartosci.client_id ? planZapamietania(w, f.wartosci.client_id, s.dane.payers) : null;
  const czego = w.payer_account ? `rachunek …${w.payer_account.slice(-4)}` : `nazwę „${w.counterparty ?? ''}”`;
  let zapamietanie = '';
  if (['czynsz', 'kaucja'].includes(f.wartosci.kind) && f.wartosci.client_id) {
    if (plan?.konflikt) {
      const inny = s.indeksy.klienci.get(plan.konflikt.client_id)?.name ?? 'inny klient';
      zapamietanie = `<p class="baner">Ten ${w.payer_account ? 'rachunek' : 'nadawca'} należy do: <strong>${esc(inny)}</strong>.
        Przypiszę tylko tę wpłatę, bez zapamiętywania.</p>`;
    } else if (plan?.istnieje) {
      zapamietanie = `<p class="podpowiedz">Ten płatnik jest już zapamiętany u tego klienta.</p>`;
    } else if (plan?.wpis) {
      zapamietanie = `${przelacznik(f, { nazwa: 'zapamietaj', etykieta: `Zapamiętaj płatnika (${czego})`, odswiez: true,
        podpowiedz: 'Kolejne wpłaty od tego płatnika przypiszą się same – także te, które już czekają.' })}
        ${f.wartosci.zapamietaj === 'on' ? pole(f, { nazwa: 'label', etykieta: 'Kim jest płatnik (opcjonalnie)',
          podpowiedz: 'Np. „mąż”, „firma”, „brat”.', atrybuty: 'maxlength="40" autocomplete="off"' }) : ''}`;
    }
  }
  const konto = w.bank_account_id ? s.indeksy.konta.get(w.bank_account_id)?.name : null;
  const szczegoly = `<section class="karta"><dl class="opis-pol">
    <dt>Nadawca</dt><dd><strong>${esc(w.counterparty || '—')}</strong></dd>
    ${w.payer_account ? `<dt>Rachunek</dt><dd class="mono">${esc(formatRachunek(w.payer_account))}</dd>` : ''}
    ${w.title ? `<dt>Tytuł</dt><dd>${esc(w.title)}</dd>` : ''}
    <dt>Data</dt><dd>${formatData(w.booked_on)}${konto ? ` · ${esc(konto)}` : ''}</dd>
    <dt>Kwota</dt><dd class="kwota">${formatZl(w.amount_gr)}</dd>
  </dl></section>`;

  return `${szczegoly}${formularz(f, {
    nazwa: 'przypisz',
    uwaga: '',
    przycisk: 'Zapisz',
    anuluj: '#/wplaty',
    tresc: `
      ${opcje(f, { nazwa: 'kind', legenda: 'Co to za wpłata', odswiez: true,
        opcje: Object.entries(RODZAJE_PRZELEWU).map(([wartosc, tekst]) => ({ wartosc, tekst })) })}
      ${f.wartosci.kind !== 'pominieta' ? wybor(f, { nazwa: 'client_id', etykieta: 'Klient', pusta: '— do przypisania —',
        opcje: opcjeKlientow(s), odswiez: true, wymagane: kaucja }) : ''}
      ${kaucja && f.wartosci.client_id ? (umowy.length ? wybor(f, { nazwa: 'contract_id', etykieta: 'Umowa, do której jest kaucja',
        wymagane: true, pusta: umowy.length > 1 ? 'Wybierz umowę…' : null, opcje: umowy })
        : '<p class="baner">Ten klient nie ma umowy – najpierw dodaj najem.</p>') : ''}
      ${poleZaJednostke(s, f)}
      ${zapamietanie}
      ${obszar(f, { nazwa: 'note', etykieta: 'Notatka', wiersze: 2, maks: 500 })}`,
  })}`;
}

export default {
  tytul(s) {
    if (s.ui.parametr === 'gotowka' || s.ui.parametr === 'przelew') return 'Nowa wpłata';
    if (s.ui.akcja === 'przypisz') return 'Przypisz wpłatę';
    if (s.ui.parametr) return 'Popraw wpłatę';
    return 'Wpłaty';
  },

  wstecz(s) {
    if (!s.ui.parametr) return null;
    const klient = s.ui.zapytanie.klient && s.indeksy.klienci.get(s.ui.zapytanie.klient);
    return klient ? { href: `#/klienci/${encodeURIComponent(klient.id)}`, tekst: klient.name }
      : { href: '#/wplaty', tekst: 'Wpłaty' };
  },

  render(s) {
    const { parametr } = s.ui;
    if (!parametr) return lista(s);
    if (parametr === 'gotowka' || parametr === 'przelew') return formularzGotowki(s, null);
    const w = s.dane.payments.find((p) => p.id === parametr);
    if (w && s.ui.akcja === 'przypisz' && w.method === 'przelew') return formularzPrzypisania(s, w);
    if (!w || !wplataReczna(w)) {
      return pustyStan('Nie znaleziono wpłaty wpisanej ręcznie.', [{ tekst: 'Wróć do wpłat', href: '#/wplaty' }]);
    }
    return formularzGotowki(s, w) + usuwanieGotowki(s, w);
  },

  akcje: {
    'usun-gotowke'(_el, ctx) {
      if (!ctx.state.ui.form) return;
      ctx.state.ui.form.potwierdzUsuniecie = true;
      ctx.render();
      document.getElementById('usun-tytul')?.scrollIntoView({ block: 'center' });
    },
    'usun-gotowke-nie'(_el, ctx) {
      if (ctx.state.ui.form) ctx.state.ui.form.potwierdzUsuniecie = false;
      ctx.render();
    },
    async 'usun-gotowke-tak'(_el, ctx) {
      const s = ctx.state;
      const w = s.dane.payments.find((p) => p.id === s.ui.parametr && wplataReczna(p));
      if (!w) return;
      await zapisz(ctx, async () => {
        await ctx.db.usun('payments', w.id);
        s.dane = { ...s.dane, payments: s.dane.payments.filter((p) => p.id !== w.id) };
        ctx.scal({});   // przelicza indeksy i odświeża kopię na urządzeniu
        ctx.toast(`Usunięto wpłatę ${formatZl(w.amount_gr)} z ${formatData(w.booked_on)}`);
        if (s.ui.zapytanie.klient) ctx.nawiguj(`klienci/${encodeURIComponent(s.ui.zapytanie.klient)}`);
        else ctx.nawiguj('wplaty');
      });
    },
  },

  przyZmianie: {
    /** Po zmianie klienta albo rodzaju „Zapamiętaj płatnika” wraca do domyślnego „włączone”. */
    przypisz(nazwa, f) {
      if (nazwa === 'client_id' || nazwa === 'kind') f.wartosci.zapamietaj = 'on';
      if (nazwa === 'client_id') f.wartosci.contract_id = '';
    },
  },

  formularze: {
    /** Przypisanie przelewu; przy „Zapamiętaj płatnika” – wpis w payers i dopasowanie pozostałych wpłat. */
    async przypisz(form, ctx) {
      const s = ctx.state;
      const wplata = s.dane.payments.find((p) => p.id === s.ui.parametr);
      if (!wplata) return;
      const w = wartosciFormularza(form);
      const kind = w.kind in RODZAJE_PRZELEWU ? w.kind : 'czynsz';
      const klientId = kind === 'pominieta' ? null : (w.client_id || null);
      const note = String(w.note ?? '').trim() || null;
      const umowaId = kind === 'kaucja' ? (w.contract_id || null) : null;
      const bledy = {};
      if (kind === 'kaucja' && !klientId) bledy.client_id = 'Wybierz klienta, który wpłacił kaucję.';
      else if (kind === 'kaucja' && !umowaId) bledy.contract_id = 'Wybierz umowę.';
      if (wplata.amount_gr <= 0 && kind === 'kaucja') bledy.kind = 'Kaucja musi być wpływem.';
      const rentalId = kind === 'czynsz' && klientId && (s.indeksy.najmyKlienta.get(klientId) ?? []).some((n) => n.id === w.rental_id)
        ? w.rental_id : null;
      if (maBledy(ctx, w, bledy)) return;
      const plan = klientId && ['czynsz', 'kaucja'].includes(kind) ? planZapamietania(wplata, klientId, s.dane.payers) : null;
      const staraKaucja = s.dane.deposits.find((d) => d.payment_id === wplata.id && d.kind === 'przyjecie');
      const zapamietaj = Boolean(plan?.wpis) && w.zapamietaj === 'on';

      await zapisz(ctx, async () => {
        const zmiany = { payments: [] };
        zmiany.payments.push(await ctx.db.zmien('payments', wplata.id, {
          kind, client_id: klientId, contract_id: umowaId, note, ...poleNajmu(rentalId, wplata),
          match_method: klientId ? 'reczne' : null, match_confirmed: Boolean(klientId),
        }));
        // Kaucja przelewem = przyjęcie kaucji w umowie (deposits), powiązane z wpłatą.
        if (kind === 'kaucja') {
          const ruch = { contract_id: umowaId, kind: 'przyjecie', amount_gr: wplata.amount_gr, method: 'przelew',
            on_date: wplata.booked_on, payment_id: wplata.id };
          zmiany.deposits = [staraKaucja ? await ctx.db.zmien('deposits', staraKaucja.id, ruch) : await ctx.db.wstaw('deposits', ruch)];
        } else if (staraKaucja) {
          await ctx.db.usun('deposits', staraKaucja.id);
          s.dane = { ...s.dane, deposits: s.dane.deposits.filter((d) => d.id !== staraKaucja.id) };
        }
        let dodatkowe = 0;
        if (zapamietaj) {
          const platnik = await ctx.db.wstaw('payers', {
            client_id: klientId, ...plan.wpis, label: String(w.label ?? '').trim() || null,
          });
          zmiany.payers = [platnik];
          const pasujace = pasujaceDoPlatnika(platnik, s.dane.payments, wplata.id);
          if (pasujace.length) {
            const zmienione = await ctx.db.zmienWiele('payments', pasujace.map((p) => p.id), {
              client_id: klientId, match_method: platnik.account ? 'rachunek' : 'nazwa', match_confirmed: true,
            });
            zmiany.payments.push(...zmienione);
            dodatkowe = zmienione.length;
          }
        }
        ctx.scal(zmiany);
        const kto = klientId ? s.indeksy.klienci.get(klientId)?.name ?? '' : '';
        ctx.toast(zapamietaj
          ? `Zapamiętano: ${plan.wpis.account ? `rachunek …${plan.wpis.account.slice(-4)}` : 'nazwa'} → ${kto}${
            dodatkowe ? ` (+${odmiana(dodatkowe, ['wpłata', 'wpłaty', 'wpłat'])})` : ''}`
          : kind === 'pominieta' ? 'Wpłata pominięta' : kind === 'kaucja' ? `Zapisano kaucję – ${kto}` : klientId ? `Przypisano do: ${kto}` : 'Zapisano');
        ctx.nawiguj('wplaty');
      });
    },

    async gotowka(form, ctx, ev) {
      const s = ctx.state;
      const edytowana = ['gotowka', 'przelew'].includes(s.ui.parametr) ? null : s.dane.payments.find((p) => p.id === s.ui.parametr);
      const w = wartosciFormularza(form);
      const kolejna = ev?.submitter?.value === 'kolejna';
      const { bledy, wiersz: nowy } = walidujGotowke(w, {
        klienci: s.indeksy.klienci, konta: s.indeksy.konta, najmyKlienta: s.indeksy.najmyKlienta,
        dataStart: ustawienia(s).data_start, dzis: dzisiaj(),
      });
      if (maBledy(ctx, w, bledy)) return;
      const { rental_id: rentalId, ...reszta } = nowy;
      const doZapisu = { ...reszta, ...poleNajmu(rentalId, edytowana) };

      await zapisz(ctx, async () => {
        const zapisana = edytowana
          ? await ctx.db.zmien('payments', edytowana.id, doZapisu)
          : await ctx.db.wstaw('payments', doZapisu);
        ctx.scal({ payments: [zapisana] });
        const kto = s.indeksy.klienci.get(zapisana.client_id)?.name ?? '';
        ctx.toast(`${edytowana ? 'Poprawiono' : 'Dodano'} wpłatę ${formatZl(zapisana.amount_gr)} – ${kto}`);
        if (kolejna) {
          // Ta sama data, nowy klient i kwota – szybkie wpisywanie kilku wpłat z zeszytu.
          s.ui.form = null;
          stanFormularza(s, `wplaty/${s.ui.parametr}/`, () => ({ booked_on: zapisana.booked_on, kind: 'czynsz',
            method: zapisana.method, bank_account_id: zapisana.bank_account_id ?? '' }));
          ctx.render();
          document.getElementById('f-client_id')?.focus();
        } else if (s.ui.zapytanie.klient) ctx.nawiguj(`klienci/${encodeURIComponent(s.ui.zapytanie.klient)}`);
        else ctx.nawiguj('wplaty');
      });
    },
  },

  poRenderze(root, s) {
    if (!s.ui.parametr) pokazWybranyMiesiac(root);
  },
};
