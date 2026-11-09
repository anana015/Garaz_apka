// Ustawienia (8.8): konta bankowe, rozliczenia, podatek, dane i konto.
// Na razie odczyt wartości; formularze edycji – krok 1a (rozliczenia, dane) i 1b (konta).

import { WERSJA, DNI_PRZYPOMNIENIA_KOPII } from '../config.js';
import { przycisk, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, dataZeZnacznika, formatData, formatZl, formatProcentBp, formatRachunek, roznicaDni,
} from '../utils.js';
import { ustawienia } from './wspolne.js';

const NAZWY_BANKOW = { nest: 'Nest Bank', pekao: 'Pekao', pko: 'PKO BP', alior: 'Alior', inny: 'Inny bank' };

function sekcja(id, tytul, tresc) {
  return `<section class="karta" aria-labelledby="u-${id}"><h2 id="u-${id}">${tytul}</h2>${tresc}</section>`;
}

const pola = (wiersze) => `<dl class="opis-pol">${wiersze
  .map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`;

function kontaBankowe(s) {
  const konta = s.dane.bank_accounts.filter((k) => !k.archived);
  const lista = konta.length
    ? `<ul class="lista">${konta.map((k) => `<li><div class="wiersz"><div class="glowna">
        <strong>${esc(k.name)}</strong>
        <span>${esc(NAZWY_BANKOW[k.bank] ?? k.bank)}${k.iban ? ` · <span class="mono">${esc(formatRachunek(k.iban))}</span>` : ''}</span>
      </div></div></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak kont. Dodaj konta, z których pobierasz wyciągi.</p>';
  return lista + `<div class="pasek-akcji">${przycisk({ tekst: 'Dodaj konto', akcja: 'nowe-konto', drugi: true, ikona: 'plus' })}</div>`;
}

/** Pasek „Ostatnia kopia: [data]. Zapisz nową” po 30 dniach (rozdz. 10). */
function przypomnienieKopii(u) {
  if (!u.last_backup_at) return '<div class="baner ostrzezenie">Nie zapisano jeszcze kopii zapasowej.</div>';
  const data = dataZeZnacznika(u.last_backup_at);
  return roznicaDni(data, dzisiaj()) > DNI_PRZYPOMNIENIA_KOPII
    ? `<div class="baner ostrzezenie">Ostatnia kopia: ${formatData(data)}. Zapisz nową.</div>` : '';
}

export default {
  tytul: () => 'Ustawienia',

  render(s) {
    const u = ustawienia(s);
    const ostatni = u.default_last_period === 'pelny' ? 'pełny okres' : 'proporcjonalnie';
    return `
      <div class="siatka">
        ${sekcja('konta', 'Konta bankowe', kontaBankowe(s))}
        ${sekcja('rozliczenia', 'Rozliczenia', pola([
          ['Tolerancja terminowości', `${u.tolerance_days} dni`],
          ['Okno terminowości', `${u.punctuality_months} mies.`],
          ['Ostrzeżenie o końcu umowy', `${u.expiring_days} dni wcześniej`],
          ['Ostatni okres najmu', ostatni],
        ]))}
        ${sekcja('podatek', 'Podatek', pola([
          ['Wpłaty ryczałtu', u.tax_period === 'miesiac' ? 'miesięcznie' : 'kwartalnie'],
          ['Stawki', `${formatProcentBp(u.tax_rate_low_bp)} / ${formatProcentBp(u.tax_rate_high_bp)}`],
          ['Próg wyższej stawki', `<span class="kwota">${formatZl(u.tax_threshold_gr, { grosze: false })}</span>`],
          ['Limit zwolnienia z VAT', `<span class="kwota">${formatZl(u.vat_limit_gr, { grosze: false })}</span>`],
          ['Mikrorachunek podatkowy', u.tax_account ? `<span class="mono">${esc(formatRachunek(u.tax_account))}</span>` : 'nie podano'],
        ]))}
        ${sekcja('dane', 'Dane', `${przypomnienieKopii(u)}${pola([['Data startu danych', formatData(u.data_start)]])}
          <div class="pasek-akcji">
            ${przycisk({ tekst: 'Wczytaj dane startowe', akcja: 'dane-startowe', drugi: true })}
            ${przycisk({ tekst: 'Zapisz kopię', akcja: 'kopia', drugi: true })}
          </div>`)}
        ${sekcja('konto', 'Konto', s.podglad
          ? '<p class="wyciszony">Tryb podglądu – brak logowania.</p>'
          : `${pola([['Zalogowano jako', esc(s.uzytkownik?.email ?? '—')]])}
             <div class="pasek-akcji">${przycisk({ tekst: 'Wyloguj', akcja: 'wyloguj', drugi: true, ikona: 'wyloguj' })}</div>`)}
      </div>
      ${wPlanie('Edycja ustawień i dane startowe – krok 1a. Konta bankowe – krok 1b. Kopia zapasowa i eksporty – krok 1d.')}
      <p class="wyciszony maly">Wersja ${esc(WERSJA)}</p>`;
  },

  akcje: {
    'nowe-konto': (_el, ctx) => ctx.toast('Formularz konta bankowego – krok 1b.'),
    'dane-startowe': (_el, ctx) => ctx.toast('Import danych startowych – krok 1a.'),
    kopia: (_el, ctx) => ctx.toast('Kopia zapasowa – krok 1d.'),
    async wyloguj(el, ctx) {
      el.setAttribute('aria-disabled', 'true');
      try {
        await ctx.db.wyloguj();   // app.js przełączy na logowanie po zmianie sesji
      } catch {
        el.removeAttribute('aria-disabled');
        ctx.toast('Nie udało się wylogować. Sprawdź połączenie.');
      }
    },
  },
};
