// Ekran „Dane startowe” (7.5) w Ustawieniach: #/ustawienia/dane-startowe.
// Wybór plików → podgląd z walidacją (plik, wiersz, powód) → zapis wszystkiego albo niczego.
// Pliki czyta przeglądarka; do bazy trafia jeden pakiet (db.zapiszPakiet).

import { dekoduj, doCsv } from '../csv.js';
import { stanFormularza, zapisz } from '../formularz.js';
import { RODZAJE, SZABLONY, przygotujImport } from '../startowe.js';
import { esc, dzisiaj, formatData, odmiana } from '../utils.js';
import { ustawienia } from './wspolne.js';

const LIMIT_BLEDOW = 100;   // dłuższa lista nic nie wnosi – po poprawkach wczytuje się plik ponownie
const ODMIANY = {
  units: ['jednostka', 'jednostki', 'jednostek'],
  clients: ['klient', 'klientów', 'klientów'],          // „2 klientów” – rzeczownik męskoosobowy
  contracts: ['umowa', 'umowy', 'umów'],
  rentals: ['najem', 'najmy', 'najmów'],
  deposits: ['kaucja', 'kaucje', 'kaucji'],
  payments: ['wpłata gotówkowa', 'wpłaty gotówkowe', 'wpłat gotówkowych'],
};

/** Stan ekranu: wczytane pliki { [rodzaj]: { nazwa, tekst } } – zostaje po wyjściu z ekranu do zapisu albo „Wyczyść”. */
function stan(s) {
  s.ui.startowe ??= { pliki: {} };
  return s.ui.startowe;
}

function wynik(s) {
  const st = stan(s);
  const teksty = Object.fromEntries(Object.entries(st.pliki).map(([r, p]) => [r, p.tekst]));
  return przygotujImport(teksty, { dane: s.dane, ustawienia: ustawienia(s), dzis: dzisiaj() });
}

function kartaPliku(s, rodzaj) {
  const sz = SZABLONY[rodzaj];
  const wybrany = stan(s).pliki[rodzaj];
  const id = `start-${rodzaj}`;
  return `<section class="karta plik-startowy" aria-labelledby="${id}-tytul">
    <h2 id="${id}-tytul">${esc(sz.tytul)} <span class="wyciszony maly mono">${esc(sz.plik)}</span></h2>
    <p class="podpowiedz">Kolumny: ${sz.kolumny.map((k) => (sz.wymagane.includes(k) ? `<strong>${k}</strong>` : k)).join('; ')}
      <br>Przykład: <span class="mono">${esc(sz.przyklad)}</span></p>
    <div class="pole">
      <label for="${id}">Plik CSV</label>
      <input id="${id}" type="file" accept=".csv,text/csv" data-zmiana="plik-startowy" data-rodzaj="${rodzaj}">
      ${wybrany ? `<p class="wybrany-plik">Wczytano: <strong>${esc(wybrany.nazwa)}</strong>
        <button type="button" class="link-btn" data-akcja="usun-startowy" data-rodzaj="${rodzaj}">Usuń</button></p>` : ''}
    </div>
    <button type="button" class="link-btn" data-akcja="szablon" data-rodzaj="${rodzaj}">Pobierz szablon ${esc(sz.plik)}</button>
  </section>`;
}

function podsumowanie(s) {
  const st = stan(s);
  if (!Object.keys(st.pliki).length) return '';
  const { bledy, liczby } = wynik(s);
  const f = stanFormularza(s, 'ustawienia/dane-startowe', () => ({}));
  const doZapisu = Object.entries(ODMIANY).filter(([t]) => liczby[t]).map(([t, formy]) => odmiana(liczby[t], formy));
  const pusto = !doZapisu.length;

  const listaBledow = bledy.length ? `
    <div class="baner blad" role="alert"><span><strong>${odmiana(bledy.length, ['błąd', 'błędy', 'błędów'])}.</strong>
      Popraw pliki w Excelu i wczytaj je ponownie. Nic nie zostanie zapisane, dopóki są błędy.</span></div>
    <div class="tabela-przewijana"><table class="tabela">
      <caption class="sr-only">Błędy w plikach</caption>
      <thead><tr><th scope="col">Plik</th><th scope="col">Wiersz</th><th scope="col">Powód</th></tr></thead>
      <tbody>${bledy.slice(0, LIMIT_BLEDOW).map((b) => `<tr><td class="mono">${esc(b.plik)}</td>
        <td class="mono">${b.nr}</td><td>${esc(b.powod)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${bledy.length > LIMIT_BLEDOW ? `<p class="podpowiedz">Pokazano pierwsze ${LIMIT_BLEDOW}.</p>` : ''}` : '';

  return `<form class="karta formularz" data-formularz="startowe" aria-labelledby="start-podsumowanie" novalidate>
    <h2 id="start-podsumowanie">Podgląd</h2>
    ${pusto ? '<p class="wyciszony">Pliki nie zawierają poprawnych wierszy.</p>'
      : `<p>Do zapisania: ${doZapisu.join(', ')}.</p>`}
    ${listaBledow}
    ${f.blad ? `<p id="f-blad-zapisu" class="blad-tekst" role="alert" tabindex="-1">${esc(f.blad)}</p>` : ''}
    <div class="pasek-akcji pasek-formularza">
      <button class="przycisk" type="submit"${bledy.length || pusto || f.trwa ? ' disabled' : ''}>${
  f.trwa ? 'Zapisywanie…' : 'Zapisz wszystko'}</button>
      <button type="button" class="link-btn" data-akcja="wyczysc-startowe">Wyczyść</button>
    </div>
  </form>`;
}

export default {
  tytul: () => 'Dane startowe',

  render(s) {
    const u = ustawienia(s);
    return `
      <section class="karta">
        <p>Wczytaj dane z Excela zapisane jako CSV (średnik, UTF-8). Możesz wczytać jeden plik albo wszystkie naraz –
          zapisze się wszystko albo nic.</p>
        <ol class="kroki">
          <li>Jednostki.</li>
          <li>Klienci z saldem otwarcia na ${formatData(u.data_start)} (ujemne = zaległość).</li>
          <li>Najmy i kaucje. Klient po nazwie albo NIP, jednostka po numerze. Ten sam numer umowy łączy jednostki w jedną umowę.</li>
          <li>Wyciągi z banku od ${formatData(u.data_start)} – w Imporcie (krok 1b).</li>
          <li>Wpłaty gotówkowe od ${formatData(u.data_start)}.</li>
        </ol>
        <p class="podpowiedz">Daty: 15.03.2026 albo 2026-03-15. Kwoty: 300 albo 300,50. Pogrubione kolumny są wymagane.</p>
      </section>
      <div class="siatka">${RODZAJE.map((r) => kartaPliku(s, r)).join('')}</div>
      ${podsumowanie(s)}`;
  },

  akcje: {
    /** Szablon CSV z nagłówkiem – średnik i BOM, żeby Excel otworzył go poprawnie (7.5). */
    szablon(el) {
      const sz = SZABLONY[el.dataset.rodzaj];
      const url = URL.createObjectURL(new Blob([doCsv(sz.kolumny)], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: sz.plik });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    'usun-startowy'(el, ctx) {
      delete stan(ctx.state).pliki[el.dataset.rodzaj];
      ctx.render();
      document.getElementById(`start-${el.dataset.rodzaj}`)?.focus();
    },
    'wyczysc-startowe'(_el, ctx) {
      stan(ctx.state).pliki = {};
      ctx.state.ui.form = null;
      ctx.render();
    },
  },

  zmiany: {
    async 'plik-startowy'(el, ctx) {
      const plik = el.files?.[0];
      if (!plik) return;
      if (!/\.(csv|txt)$/i.test(plik.name)) {
        ctx.toast('To nie jest plik CSV. W Excelu: Plik → Zapisz jako → CSV UTF-8.');
        el.value = '';
        return;
      }
      stan(ctx.state).pliki[el.dataset.rodzaj] = { nazwa: plik.name, tekst: dekoduj(await plik.arrayBuffer()) };
      if (ctx.state.ui.form) ctx.state.ui.form.blad = null;
      ctx.render();
      document.getElementById('start-podsumowanie')?.scrollIntoView({ block: 'nearest' });
    },
  },

  formularze: {
    async startowe(_form, ctx) {
      const s = ctx.state;
      const { bledy, pakiet, liczby } = wynik(s);
      stanFormularza(s, 'ustawienia/dane-startowe', () => ({}));
      if (bledy.length) return;   // przycisk jest wtedy nieaktywny; lista błędów jest nad nim
      await zapisz(ctx, async () => {
        ctx.scal(await ctx.db.zapiszPakiet(pakiet));
        s.ui.startowe = { pliki: {} };
        const co = [liczby.units && odmiana(liczby.units, ODMIANY.units), liczby.clients && odmiana(liczby.clients, ODMIANY.clients),
          liczby.rentals && odmiana(liczby.rentals, ODMIANY.rentals)].filter(Boolean);
        ctx.toast(`Zapisano dane startowe${co.length ? `: ${co.join(', ')}` : ''}`);
        ctx.nawiguj(liczby.units || liczby.rentals ? 'jednostki' : 'klienci');
      });
    },
  },
};
