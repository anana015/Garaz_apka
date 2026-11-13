// Wyszukiwarka globalna (0.24.0): #/szukaj – klienci, jednostki, wpłaty. #/szukaj?cel=notatka – wybór klienta do notatki.
// Lupa w nagłówku albo klawisz „/” na komputerze.

import { biezacyNajem, opisPlatnosci } from '../dane.js';
import { szukajWszedzie } from '../szukaj.js';
import { esc, dzisiaj, formatData, formatZl, odmiana } from '../utils.js';
import { TYPY_JEDNOSTEK } from '../config.js';

const CELE = {
  notatka: { tytul: 'Notatka lub zadanie – wybierz klienta', href: (id) => `#/klienci/${id}/notatka` },
  wplata: { tytul: 'Wpłata – wybierz klienta', href: (id) => `#/wplaty/gotowka?klient=${id}` },
};

function sekcja(tytul, elementy, wiersz) {
  if (!elementy.length) return '';
  return `<section class="karta szeroka" aria-label="${esc(tytul)}"><h2>${esc(tytul)}</h2>
    <ul class="lista">${elementy.map(wiersz).join('')}</ul></section>`;
}

export default {
  tytul: (s) => CELE[s.ui.zapytanie.cel]?.tytul ?? 'Szukaj',
  wstecz: () => ({ href: '#/pulpit', tekst: 'Pulpit' }),

  render(s) {
    const cel = CELE[s.ui.zapytanie.cel] ?? null;
    const tekst = s.ui.szukaj.szukaj ?? '';
    const dzis = dzisiaj();
    const pole = `<label class="sr-only" for="szukaj-globalne">Szukaj</label>
      <input class="szukaj duze" id="szukaj-globalne" type="search" data-pole="szukaj" autocomplete="off" enterkeyhint="search"
        placeholder="${cel ? 'Nazwisko, firma, telefon…' : 'Klient, telefon, jednostka (np. G-03), kwota, tytuł przelewu…'}"
        value="${esc(tekst)}">`;
    if (tekst.trim().length < 2) {
      return `${pole}<p class="podpowiedz">Wpisz co najmniej 2 znaki. ${cel ? '' : 'Szukam w klientach (nazwa, telefon, e-mail, NIP, adres), jednostkach i wpłatach (nadawca, tytuł, kwota).'}</p>`;
    }
    const w = szukajWszedzie(s, tekst, { tylkoKlienci: Boolean(cel), dzis });
    if (!w.razem) return `${pole}<p class="pusty">Nic nie znaleziono dla „${esc(tekst)}”.</p>`;

    const klienci = sekcja(`Klienci (${w.klienci.length})`, w.klienci, (k) => {
      const najmy = s.indeksy.najmyKlienta.get(k.id) ?? [];
      const kody = najmy.filter((n) => !n.end_on || n.end_on >= dzis).map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean);
      const id = encodeURIComponent(k.id);
      return `<li><a class="wiersz" href="${cel ? cel.href(id) : `#/klienci/${id}`}">
        <div class="glowna"><strong>${esc(k.name)}</strong>
          <span>${[k.phone, k.email].filter(Boolean).map(esc).join(' · ') || 'brak kontaktu'}</span></div>
        <div class="prawa">${kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}${k.archived ? '<span class="wyciszony maly">archiwum</span>' : ''}</div>
      </a></li>`;
    });
    if (cel) return pole + klienci;

    const jednostki = sekcja(`Jednostki (${w.jednostki.length})`, w.jednostki, (j) => {
      const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzis);
      const klient = najem ? s.indeksy.klienci.get(s.indeksy.umowy.get(najem.contract_id)?.client_id) : null;
      return `<li><a class="wiersz" href="#/jednostki/${encodeURIComponent(j.id)}">
        <div class="glowna"><strong class="mono">${esc(j.code)}</strong>
          <span>${esc(TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type)}${klient ? ` · ${esc(klient.name)} · ${esc(opisPlatnosci(najem, s.indeksy.konta))}` : ''}</span></div>
        <div class="prawa">${klient ? '<span class="status zajeta">zajęta</span>' : j.out_of_service
    ? '<span class="status wylaczona">wyłączona</span>' : '<span class="status wolna">wolna</span>'}</div>
      </a></li>`;
    });

    const wplaty = sekcja(`Wpłaty (${w.wplaty.length}${w.wplaty.length === 20 ? '+' : ''})`, w.wplaty, (p) => {
      const klient = p.client_id ? s.indeksy.klienci.get(p.client_id) : null;
      const href = !p.client_id && p.kind === 'czynsz' && p.method === 'przelew'
        ? `#/wplaty/${encodeURIComponent(p.id)}/przypisz` : klient ? `#/klienci/${encodeURIComponent(klient.id)}` : '#/wplaty';
      return `<li><a class="wiersz" href="${href}">
        <div class="glowna"><strong>${esc(klient?.name ?? p.counterparty ?? 'bez nadawcy')}</strong>
          <span>${formatData(p.booked_on)} · ${esc(p.title ?? (p.method === 'gotowka' ? 'gotówka' : ''))}</span></div>
        <div class="prawa"><div class="kwota">${formatZl(p.amount_gr)}</div>
          ${!p.client_id && p.kind === 'czynsz' ? '<div class="maly"><span class="status czesciowo">do przypisania</span></div>' : ''}</div>
      </a></li>`;
    });

    return `${pole}<p class="wyciszony maly" role="status">${odmiana(w.razem, ['wynik', 'wyniki', 'wyników'])}</p>
      <div class="siatka">${klienci}${jednostki}${wplaty}</div>`;
  },

  poRenderze(root) {
    const pole = root.querySelector('#szukaj-globalne');
    if (pole && document.activeElement !== pole && !pole.value) pole.focus({ preventScroll: true });
  },
};
