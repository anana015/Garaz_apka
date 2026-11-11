// Tryb „Edytuj” w stylu ustawień (prośba 11.11): rozwijane grupy i menu pozycji.
// Używane na karcie klienta i w szczegółach jednostki.

import { najemTrwa, najemZakonczony, opisPlatnosci, stawkaNaDzien } from '../dane.js';
import { promocjaNajmu } from '../promocje.js';
import { dodajDni, dzisiaj, esc, formatData, formatDataKrotka, formatZl } from '../utils.js';

/** Rozwijana grupa ustawień: tytuł, jednolinijkowy opis stanu, treść po rozwinięciu. */
export const grupa = (tytul, opisStanu, tresc, { mono = false, otwarta = false } = {}) => `<details class="grupa-ustawien"${otwarta ? ' open' : ''}>
    <summary><span class="glowna"><strong${mono ? ' class="mono"' : ''}>${tytul}</strong>${opisStanu ? `<span>${opisStanu}</span>` : ''}</span></summary>
    <div class="tresc">${tresc}</div></details>`;

/** Pozycja menu ustawień: link albo przycisk akcji, z opcjonalną wartością po prawej. */
export const pozycja = ({ tekst, href, akcja, id, wartosc = '' }) => `<li>${href
  ? `<a class="pozycja" href="${href}"><span>${tekst}</span><span class="wartosc">${wartosc}</span></a>`
  : `<button type="button" class="pozycja" data-akcja="${akcja}"${id ? ` data-id="${esc(id)}"` : ''}><span>${tekst}</span>
      <span class="wartosc">${wartosc}</span></button>`}</li>`;

export const menu = (pozycje) => `<ul class="menu-ustawien">${pozycje.filter(Boolean).join('')}</ul>`;

/** Karta „Ustawienia …” z przyciskiem „Gotowe” nad nią. */
export const kartaUstawien = (s, { id, tytul, tresc, przyciskEdycji }) => `
  <div class="pasek-akcji">${przyciskEdycji(s)}</div>
  <section class="karta ustawienia-klienta" aria-labelledby="${id}">
    <h2 id="${id}">${tytul}</h2>
    <p class="podpowiedz">Rozwiń grupę, żeby coś zmienić. „Gotowe” wraca do zwykłego widoku.</p>
    ${tresc}
  </section>`;

/**
 * Grupa jednego najmu: stawka · daty · wypowiedzenie · promocja, a po rozwinięciu menu zmian i historia stawek.
 * tytul – domyślnie numer jednostki; w szczegółach jednostki – nazwa klienta.
 */
export function grupaNajmu(s, n, dzien, { tytul = null, otwarta = false } = {}) {
  const j = s.indeksy.jednostki.get(n.unit_id);
  const stawki = [...(s.indeksy.stawkiNajmu.get(n.id) ?? [])].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const stawka = stawkaNaDzien(stawki, najemTrwa(n, dzien) ? dzien : n.end_on ?? n.start_on);
  const trwa = !najemZakonczony(n, dzien);
  const id = encodeURIComponent(n.id);
  const platnosc = opisPlatnosci(n, s.indeksy.konta);
  const promo = trwa ? promocjaNajmu(stawki, dzien) : null;
  const stan = [stawka != null ? formatZl(stawka) : null, `${formatData(n.start_on)} – ${n.end_on ? formatData(n.end_on) : 'trwa'}`,
    trwa && n.notice_end_on ? `wypowiedziana do ${formatData(n.notice_end_on)}` : trwa && n.end_on ? `najem do ${formatData(n.end_on)}` : null,
    promo ? `promocja ${promo.do ? `do ${formatDataKrotka(promo.do)}` : ''}` : null].filter(Boolean).join(' · ');
  const historia = stawki.length ? `<details class="historia-stawek"><summary>Historia stawek (${stawki.length})</summary>
      <ul>${stawki.map((st) => `<li><span>od ${formatData(st.valid_from)}${st.reason ? ` · ${esc(st.reason)}` : ''}</span>
        <span class="kwota">${formatZl(st.amount_gr)}</span></li>`).join('')}</ul></details>` : '';
  return grupa(tytul ?? esc(j?.code ?? '?'), stan, `${menu([
    pozycja({ tekst: 'Zmień stawkę', href: `#/najmy/${id}/stawka`, wartosc: stawka != null ? formatZl(stawka) : '' }),
    pozycja({ tekst: 'Promocja', href: `#/najmy/${id}/promocja`, wartosc: promo?.do ? `do ${formatData(promo.do)}` : '' }),
    pozycja({ tekst: 'Kwota 1. okresu', href: `#/najmy/${id}/korekta?tryb=kwota` }),
    pozycja({ tekst: 'Korekta należności', href: `#/najmy/${id}/korekta` }),
    pozycja({ tekst: 'Gdzie płaci', href: `#/najmy/${id}/platnosc`, wartosc: esc(platnosc) }),
    trwa && n.notice_end_on ? pozycja({ tekst: 'Cofnij wypowiedzenie', akcja: 'cofnij-wypowiedzenie', id: n.id,
      wartosc: formatData(n.notice_end_on) }) : null,
    trwa && n.start_on <= dzien ? pozycja({ tekst: 'Zakończ najem', href: `#/najmy/${id}/koniec` }) : null,
    // Najem, który jeszcze się nie zaczął (np. przejęcie jednostki) – można go anulować, gdy nie dojdzie do skutku.
    n.start_on > dzien ? (s.ui.anulujNajem === n.id
      ? pozycja({ tekst: `Na pewno anulować najem od ${formatData(n.start_on)}? Tak, anuluj`, akcja: 'anuluj-najem-tak', id: n.id,
        wartosc: 'przywróci poprzedniego najemcę' })
      : pozycja({ tekst: 'Anuluj najem (nie dojdzie do skutku)', akcja: 'anuluj-najem', id: n.id, wartosc: `od ${formatData(n.start_on)}` }))
      : null,
  ])}${historia}`, { mono: tytul == null, otwarta });
}

/**
 * Anulowanie najmu, który jeszcze się nie zaczął (prośba 11.11 – cofnięcie przejęcia jednostki):
 * usuwa najem (stawki i korekty kasują się razem z nim), przywraca poprzedniemu najemcy brak daty końca
 * (jeśli koniec ustawiło przejęcie), usuwa zadanie „Wypowiedz umowę …” i pustą umowę.
 */
export const akcjeAnulowania = {
  'anuluj-najem'(el, ctx) {
    ctx.state.ui.anulujNajem = el.dataset.id;
    ctx.render();
  },
  async 'anuluj-najem-tak'(el, ctx) {
    const s = ctx.state;
    const n = s.dane.rentals.find((x) => x.id === el.dataset.id);
    s.ui.anulujNajem = null;
    if (!n) return;
    if (s.podglad || s.offline || s.zKopii) {
      ctx.toast('Anulowanie wymaga połączenia z bazą.');
      return;
    }
    const kod = s.indeksy.jednostki.get(n.unit_id)?.code ?? '?';
    const dzienPrzed = dodajDni(n.start_on, -1);
    const poprzedni = s.dane.rentals.find((x) => x.unit_id === n.unit_id && x.id !== n.id && x.end_on === dzienPrzed)
      ?? s.dane.rentals.find((x) => x.unit_id === n.unit_id && x.id !== n.id && x.end_on && x.end_on < n.start_on
        && x.end_on === x.notice_end_on && x.end_on >= dzisiaj());
    try {
      await ctx.db.usun('rentals', n.id);
      let dane = { ...s.dane, rentals: s.dane.rentals.filter((x) => x.id !== n.id),
        rental_rates: s.dane.rental_rates.filter((x) => x.rental_id !== n.id),
        charge_adjustments: s.dane.charge_adjustments.filter((x) => x.rental_id !== n.id) };
      const zmiany = {};
      if (poprzedni) zmiany.rentals = [await ctx.db.zmien('rentals', poprzedni.id, { end_on: null })];
      // Zadanie wypowiedzenia z przejęcia
      const poczatekZadania = `Wypowiedz umowę – ${kod} od ${formatData(n.start_on)}`;
      for (const z of dane.client_notes.filter((x) => x.body?.startsWith(poczatekZadania))) {
        await ctx.db.usun('client_notes', z.id).catch(() => {});
        dane = { ...dane, client_notes: dane.client_notes.filter((x) => x.id !== z.id) };
      }
      // Umowa bez innych najmów – usuwamy (kaucje umowy kasują się razem z nią); gdy coś ją trzyma, zostaje.
      if (!dane.rentals.some((x) => x.contract_id === n.contract_id)) {
        try {
          await ctx.db.usun('contracts', n.contract_id);
          dane = { ...dane, contracts: dane.contracts.filter((x) => x.id !== n.contract_id),
            deposits: dane.deposits.filter((x) => x.contract_id !== n.contract_id) };
        } catch { /* umowa zostaje (np. powiązana wpłata kaucji) */ }
      }
      s.dane = dane;
      ctx.scal(zmiany);
      ctx.toast(`Anulowano najem ${kod} od ${formatData(n.start_on)}${poprzedni ? ' – poprzedni najem znów bez daty końca' : ''}`);
      ctx.render();
    } catch (e) {
      ctx.toast(e.message);
    }
  },
};
