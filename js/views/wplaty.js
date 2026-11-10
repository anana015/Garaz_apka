// Wpłaty (8.2): filtry, wyszukiwanie, lista, wpłata gotówką.
// Adresy: #/wplaty, #/wplaty/gotowka[?klient=<id>], #/wplaty/<id>/edycja (tylko gotówka).
// Przypisywanie wpłat z wyciągu i „Zapamiętaj płatnika” – kolejne porcje kroku 1b.

import { doPrzypisania, najemZakonczony } from '../dane.js';
import {
  formularz, maBledy, obszar, opcje, pole, stanFormularza, wartosciFormularza, wybor, zapisz,
} from '../formularz.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, formatZl, formatData, kwotaDoPola, normalizujTekst, kluczMiesiaca, etykietaMiesiaca, porownajKody,
} from '../utils.js';
import { RODZAJE_GOTOWKI, walidujGotowke } from '../walidacja.js';
import { ustawienia, wyborMiesiaca, pokazWybranyMiesiac } from './wspolne.js';

const FILTRY = {
  wszystkie: { tekst: 'Wszystkie', warunek: (w, s) => kluczMiesiaca(w.booked_on) === s.ui.miesiac },
  'do-przypisania': { tekst: 'Do przypisania', warunek: (w) => w.kind === 'czynsz' && !w.client_id },
  gotowka: { tekst: 'Gotówka', warunek: (w) => w.method === 'gotowka' },
  kaucje: { tekst: 'Kaucje', warunek: (w) => w.kind === 'kaucja' },
  pominiete: { tekst: 'Pominięte', warunek: (w) => w.kind === 'pominieta' },
};

const PUSTE = {
  wszystkie: (s) => `Brak wpłat w miesiącu ${etykietaMiesiaca(s.ui.miesiac)}.`,
  'do-przypisania': () => 'Wszystkie wpłaty są przypisane.',
  gotowka: () => 'Brak wpłat gotówkowych.',
  kaucje: () => 'Brak kaucji wpłaconych przelewem.',
  pominiete: () => 'Brak pominiętych wpłat.',
};

function wiersz(w, s) {
  const klient = w.client_id ? s.indeksy.klienci.get(w.client_id) : null;
  const gotowka = w.method === 'gotowka';
  const nadawca = gotowka ? (klient?.name ?? 'gotówka') : (w.counterparty || '—');
  const kogo = gotowka
    ? `gotówka${w.kind === 'przychod_inny' ? ' · inny przychód' : ''}`
    : klient ? esc(klient.name)
      : w.kind === 'czynsz' ? '<span class="status czesciowo">Do przypisania</span>' : '';
  const opisWiersza = w.title || (gotowka ? w.note : null);
  const tresc = `
    <div class="glowna"><strong>${esc(nadawca)}</strong>
      <span>${formatData(w.booked_on)}${opisWiersza ? ` · ${esc(opisWiersza)}` : ''}</span></div>
    <div class="prawa"><div class="kwota">${formatZl(w.amount_gr)}</div><div class="maly">${kogo}</div></div>`;
  // Wpłatę gotówką można poprawić; wpłaty z wyciągu – menu wiersza w kolejnej porcji.
  return gotowka
    ? `<li><a class="wiersz" href="#/wplaty/${encodeURIComponent(w.id)}/edycja"
        aria-label="Popraw wpłatę gotówką ${esc(nadawca)}, ${formatData(w.booked_on)}">${tresc}</a></li>`
    : `<li><div class="wiersz">${tresc}</div></li>`;
}

function lista(s) {
  const wszystkie = s.dane.payments;
  const akcje = `<div class="pasek-akcji">
    ${przycisk({ tekst: 'Wczytaj wyciąg', href: '#/import', ikona: 'import' })}
    ${przycisk({ tekst: 'Dodaj wpłatę gotówką', href: '#/wplaty/gotowka', drugi: true, ikona: 'plus' })}</div>`;
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
    ${wPlanie('Przypisywanie wpłat z wyciągu i „Zapamiętaj płatnika” – kolejne porcje kroku 1b.')}`;
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

function formularzGotowki(s, wplata) {
  const klucz = `wplaty/${s.ui.parametr}/${s.ui.akcja ?? ''}`;
  const f = stanFormularza(s, klucz, () => (wplata
    ? { booked_on: wplata.booked_on, client_id: wplata.client_id ?? '', amount_gr: kwotaDoPola(wplata.amount_gr),
      kind: wplata.kind, note: wplata.note ?? '' }
    : { booked_on: dzisiaj(), client_id: s.ui.zapytanie.klient ?? '', kind: 'czynsz' }));
  const powrot = s.ui.zapytanie.klient ? `#/klienci/${encodeURIComponent(s.ui.zapytanie.klient)}` : '#/wplaty';
  return formularz(f, {
    nazwa: 'gotowka',
    przycisk: wplata ? 'Zapisz zmiany' : 'Dodaj wpłatę',
    drugiPrzycisk: wplata ? null : { tekst: 'Dodaj i wpisz kolejną', wartosc: 'kolejna' },
    anuluj: powrot,
    tresc: `
      ${wybor(f, { nazwa: 'client_id', etykieta: 'Klient', wymagane: true, pusta: 'Wybierz klienta…', opcje: opcjeKlientow(s) })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota (zł)', typ: 'kwota', wymagane: true })}
        ${pole(f, { nazwa: 'booked_on', etykieta: 'Data wpłaty', typ: 'date', wymagane: true,
          atrybuty: `max="${dzisiaj()}" min="${esc(ustawienia(s).data_start)}"` })}
      </div>
      ${opcje(f, { nazwa: 'kind', legenda: 'Za co',
        opcje: Object.entries(RODZAJE_GOTOWKI).map(([wartosc, tekst]) => ({ wartosc, tekst })),
        podpowiedz: 'Inny przychód (np. opłata za szkody) liczy się do przychodu, ale nie zmniejsza zaległości czynszu.' })}
      ${obszar(f, { nazwa: 'note', etykieta: 'Notatka', wiersze: 2, maks: 500 })}`,
  });
}

export default {
  tytul(s) {
    if (s.ui.parametr === 'gotowka') return 'Wpłata gotówką';
    if (s.ui.parametr) return 'Popraw wpłatę gotówką';
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
    if (parametr === 'gotowka') return formularzGotowki(s, null);
    const w = s.dane.payments.find((p) => p.id === parametr);
    if (!w || w.method !== 'gotowka') {
      return pustyStan('Nie znaleziono wpłaty gotówką.', [{ tekst: 'Wróć do wpłat', href: '#/wplaty' }]);
    }
    return formularzGotowki(s, w);
  },

  formularze: {
    async gotowka(form, ctx, ev) {
      const s = ctx.state;
      const edytowana = s.ui.parametr === 'gotowka' ? null : s.dane.payments.find((p) => p.id === s.ui.parametr);
      const w = wartosciFormularza(form);
      const kolejna = ev?.submitter?.value === 'kolejna';
      const { bledy, wiersz: nowy } = walidujGotowke(w, {
        klienci: s.indeksy.klienci, dataStart: ustawienia(s).data_start, dzis: dzisiaj(),
      });
      if (maBledy(ctx, w, bledy)) return;

      await zapisz(ctx, async () => {
        const zapisana = edytowana
          ? await ctx.db.zmien('payments', edytowana.id, nowy)
          : await ctx.db.wstaw('payments', nowy);
        ctx.scal({ payments: [zapisana] });
        const kto = s.indeksy.klienci.get(zapisana.client_id)?.name ?? '';
        ctx.toast(`${edytowana ? 'Poprawiono' : 'Dodano'} wpłatę ${formatZl(zapisana.amount_gr)} – ${kto}`);
        if (kolejna) {
          // Ta sama data, nowy klient i kwota – szybkie wpisywanie kilku wpłat z zeszytu.
          s.ui.form = null;
          stanFormularza(s, `wplaty/gotowka/`, () => ({ booked_on: zapisana.booked_on, kind: 'czynsz' }));
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
