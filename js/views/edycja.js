// Tryb „Edytuj” w stylu ustawień (prośba 11.11): rozwijane grupy i menu pozycji.
// Używane na karcie klienta i w szczegółach jednostki.

import { najemTrwa, najemZakonczony, opisPlatnosci, stawkaNaDzien } from '../dane.js';
import { promocjaNajmu } from '../promocje.js';
import { esc, formatData, formatDataKrotka, formatZl } from '../utils.js';

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
    trwa && n.notice_end_on ? `wypowiedziana do ${formatData(n.notice_end_on)}` : null,
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
    trwa ? pozycja({ tekst: 'Zakończ najem', href: `#/najmy/${id}/koniec` }) : null,
  ])}${historia}`, { mono: tytul == null, otwarta });
}
