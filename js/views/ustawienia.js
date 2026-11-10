// Ustawienia (8.8): konta bankowe, rozliczenia, podatek, dane i konto.
// Adresy: #/ustawienia, #/ustawienia/edycja, #/ustawienia/konto/nowe, #/ustawienia/konto/<id>,
//         #/ustawienia/dane-startowe (import z szablonów CSV, 7.5 – views/startowe.js)

import { WERSJA, DNI_PRZYPOMNIENIA_KOPII } from '../config.js';
import {
  formularz, maBledy, opcje, pole, przelacznik, sekcja, stanFormularza, wartosciFormularza, wybor, zapisz,
} from '../formularz.js';
import { przycisk, pustyStan, wPlanie } from '../ui.js';
import {
  esc, dzisiaj, dataZeZnacznika, formatData, formatZl, formatProcentBp, formatRachunek, kwotaDoPola, roznicaDni,
} from '../utils.js';
import { BANKI, walidujKonto, walidujUstawienia } from '../walidacja.js';
import startowe from './startowe.js';
import { ustawienia } from './wspolne.js';

function sekcjaKarty(id, tytul, tresc, edycja) {
  return `<section class="karta" aria-labelledby="u-${id}">
    <div class="naglowek-karty"><h2 id="u-${id}">${tytul}</h2>${edycja
      ? `<a class="link-btn" href="${edycja}" aria-label="Zmień: ${tytul}">Zmień</a>` : ''}</div>${tresc}</section>`;
}

const pola = (wiersze) => `<dl class="opis-pol">${wiersze
  .map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`;

function kontaBankowe(s) {
  const konta = [...s.dane.bank_accounts].sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name, 'pl'));
  const lista = konta.length
    ? `<ul class="lista">${konta.map((k) => `<li><a class="wiersz" href="#/ustawienia/konto/${encodeURIComponent(k.id)}">
        <div class="glowna"><strong>${esc(k.name)}${k.archived ? ' <span class="wyciszony">(archiwalne)</span>' : ''}</strong>
        <span>${esc(BANKI[k.bank] ?? k.bank)}${k.iban ? ` · <span class="mono">${esc(formatRachunek(k.iban))}</span>` : ''}</span>
      </div></a></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak kont. Dodaj konta, z których pobierasz wyciągi.</p>';
  return lista + `<div class="pasek-akcji">${przycisk({ tekst: 'Dodaj konto', href: '#/ustawienia/konto/nowe', drugi: true, ikona: 'plus' })}</div>`;
}

/** Pasek „Ostatnia kopia: [data]. Zapisz nową” po 30 dniach (rozdz. 10). */
function przypomnienieKopii(u) {
  if (!u.last_backup_at) return '<div class="baner ostrzezenie">Nie zapisano jeszcze kopii zapasowej.</div>';
  const data = dataZeZnacznika(u.last_backup_at);
  return roznicaDni(data, dzisiaj()) > DNI_PRZYPOMNIENIA_KOPII
    ? `<div class="baner ostrzezenie">Ostatnia kopia: ${formatData(data)}. Zapisz nową.</div>` : '';
}

function przeglad(s) {
  const u = ustawienia(s);
  const ostatni = u.default_last_period === 'pelny' ? 'pełny okres' : 'proporcjonalnie';
  return `
    <div class="siatka">
      ${sekcjaKarty('konta', 'Konta bankowe', kontaBankowe(s))}
      ${sekcjaKarty('rozliczenia', 'Rozliczenia', pola([
        ['Tolerancja terminowości', `${u.tolerance_days} dni`],
        ['Okno terminowości', `${u.punctuality_months} mies.`],
        ['Ostrzeżenie o końcu umowy', `${u.expiring_days} dni wcześniej`],
        ['Ostatni okres najmu', ostatni],
      ]), '#/ustawienia/edycja')}
      ${sekcjaKarty('podatek', 'Podatek', pola([
        ['Wpłaty ryczałtu', u.tax_period === 'miesiac' ? 'miesięcznie' : 'kwartalnie'],
        ['Stawki', `${formatProcentBp(u.tax_rate_low_bp)} / ${formatProcentBp(u.tax_rate_high_bp)}`],
        ['Próg wyższej stawki', `<span class="kwota">${formatZl(u.tax_threshold_gr, { grosze: false })}</span>`],
        ['Limit zwolnienia z VAT', `<span class="kwota">${formatZl(u.vat_limit_gr, { grosze: false })}</span>`],
        ['Mikrorachunek podatkowy', u.tax_account ? `<span class="mono">${esc(formatRachunek(u.tax_account))}</span>` : 'nie podano'],
      ]), '#/ustawienia/edycja')}
      ${sekcjaKarty('dane', 'Dane', `${przypomnienieKopii(u)}${pola([['Data startu danych', formatData(u.data_start)]])}
        <div class="pasek-akcji">
          ${przycisk({ tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true })}
          ${przycisk({ tekst: 'Zapisz kopię', akcja: 'kopia', drugi: true })}
        </div>`, '#/ustawienia/edycja')}
      ${sekcjaKarty('konto', 'Konto', s.podglad
        ? '<p class="wyciszony">Tryb podglądu – brak logowania.</p>'
        : `${pola([['Zalogowano jako', esc(s.uzytkownik?.email ?? '—')]])}
           <div class="pasek-akcji">${przycisk({ tekst: 'Wyloguj', akcja: 'wyloguj', drugi: true, ikona: 'wyloguj' })}</div>`)}
    </div>
    ${wPlanie('Kopia zapasowa i eksporty – krok 1d.')}
    <p class="wyciszony maly">Wersja ${esc(WERSJA)}</p>`;
}

// ---------------------------------------------------------------------
// Edycja ustawień
// ---------------------------------------------------------------------

const procentDoPola = (bp) => (bp == null ? '' : String(bp / 100).replace('.', ','));

function wartosciUstawien(u) {
  return {
    tolerance_days: String(u.tolerance_days), punctuality_months: String(u.punctuality_months),
    expiring_days: String(u.expiring_days), default_last_period: u.default_last_period, tax_period: u.tax_period,
    tax_rate_low_bp: procentDoPola(u.tax_rate_low_bp), tax_rate_high_bp: procentDoPola(u.tax_rate_high_bp),
    tax_threshold_gr: kwotaDoPola(u.tax_threshold_gr), vat_limit_gr: kwotaDoPola(u.vat_limit_gr),
    tax_account: u.tax_account ? formatRachunek(u.tax_account) : '', data_start: u.data_start,
  };
}

function formularzUstawien(s) {
  const f = stanFormularza(s, 'ustawienia/edycja', () => wartosciUstawien(ustawienia(s)));
  const liczba = 'inputmode="numeric" min="0"';
  return formularz(f, {
    nazwa: 'ustawienia', przycisk: 'Zapisz ustawienia', anuluj: '#/ustawienia',
    tresc: `
      ${sekcja('Rozliczenia', `
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tolerance_days', etykieta: 'Tolerancja terminowości (dni)', typ: 'number', wymagane: true,
            podpowiedz: 'Wpłata do tylu dni po terminie jest terminowa (Z28).', atrybuty: liczba })}
          ${pole(f, { nazwa: 'punctuality_months', etykieta: 'Okno terminowości (mies.)', typ: 'number', wymagane: true,
            podpowiedz: 'Z ilu ostatnich miesięcy liczyć terminowość (Z30).', atrybuty: liczba })}
        </div>
        ${pole(f, { nazwa: 'expiring_days', etykieta: 'Ostrzeżenie o końcu umowy (dni wcześniej)', typ: 'number', wymagane: true,
          atrybuty: liczba })}
        ${opcje(f, { nazwa: 'default_last_period', legenda: 'Domyślny ostatni okres nowego najmu (Z8)', opcje: [
          { wartosc: 'proporcjonalnie', tekst: 'Proporcjonalnie do dni' }, { wartosc: 'pelny', tekst: 'Pełny okres' }] })}`)}
      ${sekcja('Podatek', `
        ${opcje(f, { nazwa: 'tax_period', legenda: 'Wpłaty ryczałtu', opcje: [
          { wartosc: 'kwartal', tekst: 'Kwartalnie' }, { wartosc: 'miesiac', tekst: 'Miesięcznie' }] })}
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tax_rate_low_bp', etykieta: 'Stawka do progu (%)', wymagane: true, atrybuty: 'inputmode="decimal"' })}
          ${pole(f, { nazwa: 'tax_rate_high_bp', etykieta: 'Stawka ponad próg (%)', wymagane: true, atrybuty: 'inputmode="decimal"' })}
        </div>
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tax_threshold_gr', etykieta: 'Próg wyższej stawki (zł)', typ: 'kwota', wymagane: true })}
          ${pole(f, { nazwa: 'vat_limit_gr', etykieta: 'Limit zwolnienia z VAT (zł)', typ: 'kwota', wymagane: true })}
        </div>
        ${pole(f, { nazwa: 'tax_account', etykieta: 'Mikrorachunek podatkowy', atrybuty: 'inputmode="numeric" autocomplete="off"',
          podpowiedz: '26 cyfr. Pokazywany przy kwocie ryczałtu do zapłaty.' })}`)}
      ${sekcja('Dane', `
        ${pole(f, { nazwa: 'data_start', etykieta: 'Data startu danych', typ: 'date', wymagane: true,
          podpowiedz: 'Należności liczone są od tej daty, wcześniejszy stan to saldo otwarcia klienta (Z34). Zmiana przelicza wszystko od razu.' })}`)}`,
  });
}

async function zapiszUstawienia(form, ctx) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujUstawienia(w, { dzis: dzisiaj() });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, wiersz) });
    ctx.toast('Ustawienia zapisane');
    ctx.nawiguj('ustawienia');
  });
}

// ---------------------------------------------------------------------
// Konto bankowe
// ---------------------------------------------------------------------

function formularzKonta(s, konto) {
  const f = stanFormularza(s, `ustawienia/konto/${s.ui.akcja}`, () => (konto
    ? { name: konto.name, bank: konto.bank, iban: konto.iban ? formatRachunek(konto.iban) : '', archived: konto.archived ? 'on' : '' }
    : { bank: '' }));
  return formularz(f, {
    nazwa: 'konto', przycisk: konto ? 'Zapisz konto' : 'Dodaj konto', anuluj: '#/ustawienia',
    tresc: `
      ${pole(f, { nazwa: 'name', etykieta: 'Nazwa', wymagane: true, podpowiedz: 'Np. „Nest – najem”.', atrybuty: 'maxlength="60"' })}
      ${wybor(f, { nazwa: 'bank', etykieta: 'Bank', wymagane: true, pusta: 'Wybierz…',
        opcje: Object.entries(BANKI).map(([wartosc, tekst]) => ({ wartosc, tekst })),
        podpowiedz: 'Określa sposób odczytu wyciągu CSV (7.1).' })}
      ${pole(f, { nazwa: 'iban', etykieta: 'Numer rachunku', atrybuty: 'inputmode="numeric" autocomplete="off"',
        podpowiedz: '26 cyfr. Pozwala rozpoznać konto po nagłówku wyciągu.' })}
      ${konto ? przelacznik(f, { nazwa: 'archived', etykieta: 'Konto archiwalne (nie pokazuj przy imporcie)' }) : ''}`,
  });
}

async function zapiszKonto(form, ctx) {
  const s = ctx.state;
  const konto = s.ui.akcja === 'nowe' ? null : s.indeksy.konta.get(s.ui.akcja);
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujKonto(w, { konta: s.dane.bank_accounts, id: konto?.id ?? null });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const zapisane = konto ? await ctx.db.zmien('bank_accounts', konto.id, wiersz) : await ctx.db.wstaw('bank_accounts', wiersz);
    ctx.scal({ bank_accounts: [zapisane] });
    ctx.toast(konto ? 'Konto zapisane' : `Dodano konto ${zapisane.name}`);
    ctx.nawiguj('ustawienia');
  });
}

// ---------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------

export default {
  tytul(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'edycja') return 'Edycja ustawień';
    if (parametr === 'konto') return akcja === 'nowe' ? 'Nowe konto' : 'Konto bankowe';
    if (parametr === 'dane-startowe') return startowe.tytul(s);
    return 'Ustawienia';
  },

  wstecz: (s) => (s.ui.parametr ? { href: '#/ustawienia', tekst: 'Ustawienia' } : null),

  render(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'edycja') return formularzUstawien(s);
    if (parametr === 'dane-startowe') return startowe.render(s);
    if (parametr === 'konto') {
      const konto = akcja === 'nowe' ? null : s.indeksy.konta.get(akcja);
      if (akcja !== 'nowe' && !konto) return pustyStan('Nie znaleziono konta.', [{ tekst: 'Ustawienia', href: '#/ustawienia' }]);
      return formularzKonta(s, konto);
    }
    return przeglad(s);
  },

  akcje: {
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
    ...startowe.akcje,
  },

  zmiany: { ...startowe.zmiany },

  formularze: {
    ustawienia: zapiszUstawienia,
    konto: zapiszKonto,
    ...startowe.formularze,
  },
};
