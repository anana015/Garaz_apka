// Klienci (8.4) i karta klienta (8.5, na razie dane i najmy).

import { najemTrwa, najemZakonczony, stawkaNaDzien } from '../dane.js';
import { filtry, poleSzukaj, przycisk, pustyStan, wPlanie } from '../ui.js';
import { esc, dzisiaj, formatData, formatZl, normalizujTekst, porownajKody } from '../utils.js';

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
  const akcje = `<div class="pasek-akcji">${przycisk({ tekst: 'Nowy klient', akcja: 'nowy', ikona: 'plus' })}</div>`;

  if (!s.dane.clients.length) {
    return akcje + pustyStan('Nie ma jeszcze klientów. Dodaj klienta albo wczytaj dane startowe.', [
      { tekst: 'Wczytaj dane startowe', href: '#/ustawienia', drugi: true }]);
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

function opis(etykieta, wartosc) {
  return wartosc ? `<dt>${etykieta}</dt><dd>${wartosc}</dd>` : '';
}

function karta(s, klient) {
  const dzien = dzisiaj();
  const najmy = [...(s.indeksy.najmyKlienta.get(klient.id) ?? [])]
    .sort((a, b) => b.start_on.localeCompare(a.start_on));
  const kontakt = [
    opis('Telefon', klient.phone && `<a href="tel:${esc(klient.phone.replace(/[^\d+]/g, ''))}">${esc(klient.phone)}</a>`),
    opis('E-mail', klient.email && `<a href="mailto:${esc(klient.email)}">${esc(klient.email)}</a>`),
    opis('NIP', klient.nip && `<span class="mono">${esc(klient.nip)}</span>`),
    opis('Adres', klient.address && esc(klient.address)),
    opis('Osoba kontaktowa', klient.contact_person && esc(klient.contact_person)),
  ].join('');

  const wierszNajmu = (n) => {
    const j = s.indeksy.jednostki.get(n.unit_id);
    const stawka = stawkaNaDzien(s.indeksy.stawkiNajmu.get(n.id), najemTrwa(n, dzien) ? dzien : n.end_on ?? n.start_on);
    return `<li><div class="wiersz">
      <div class="glowna"><strong class="mono">${esc(j?.code ?? '?')}</strong>
        <span>${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'} · płatne ${n.billing_day}. dnia</span></div>
      <div class="prawa kwota">${stawka != null ? formatZl(stawka) : '—'}</div></div></li>`;
  };

  return `
    <div class="siatka">
      <section class="karta" aria-labelledby="k-kontakt"><h2 id="k-kontakt">Kontakt</h2>
        ${kontakt ? `<dl class="opis-pol">${kontakt}</dl>` : '<p class="wyciszony">Brak danych kontaktowych.</p>'}</section>
      <section class="karta" aria-labelledby="k-najmy"><h2 id="k-najmy">Najmy</h2>
        ${najmy.length ? `<ul class="lista">${najmy.map(wierszNajmu).join('')}</ul>` : '<p class="wyciszony">Brak najmów.</p>'}</section>
    </div>
    ${wPlanie('Saldo, kartoteka rozrachunków, terminowość, kaucja, płatnicy i notatki – krok 1c.')}`;
}

export default {
  tytul(s) {
    if (!s.ui.parametr) return 'Klienci';
    return s.indeksy.klienci.get(s.ui.parametr)?.name ?? 'Klient';
  },

  wstecz: (s) => (s.ui.parametr ? { href: '#/klienci', tekst: 'Klienci' } : null),

  render(s) {
    if (!s.ui.parametr) return lista(s);
    const klient = s.indeksy.klienci.get(s.ui.parametr);
    return klient ? karta(s, klient) : pustyStan('Nie znaleziono klienta.', [{ tekst: 'Wróć do listy', href: '#/klienci' }]);
  },

  akcje: {
    nowy(_el, ctx) {
      ctx.toast('Formularz klienta – następna część kroku 1a.');
    },
  },
};
