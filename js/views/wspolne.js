// Fragmenty używane przez kilka widoków.

import { DOMYSLNE_USTAWIENIA } from '../config.js';
import { doCsv } from '../csv.js';
import { eksportDluznikow, eksportJednostek, eksportKlientow, eksportKosztow, eksportWplat } from '../eksport.js';
import { daneGrupy, GRUPY_RYCZALTU, NAGLOWEK_CSV, wierszeCsv, zestawienieRoku } from '../podatek.js';
import { rozliczenia } from '../rozliczenia.js';
import { pobierzPlik } from '../ui.js';
import {
  esc, dzisiaj, kluczMiesiaca, zakresMiesiecy, etykietaMiesiaca, formatData, formatProcentBp, formatZl, MIESIACE_KROTKO,
} from '../utils.js';

/** Ustawienia z bazy albo domyślne (tryb podglądu, pierwsze uruchomienie). */
export const ustawienia = (s) => ({ ...DOMYSLNE_USTAWIENIA, ...(s.dane.settings ?? {}) });

/** Poziomy wybór miesiąca od daty startu danych do bieżącego miesiąca (8.1). */
export function wyborMiesiaca(s) {
  const biezacy = kluczMiesiaca(dzisiaj());
  const od = kluczMiesiaca(ustawienia(s).data_start);
  const rokBiezacy = biezacy.slice(0, 4);
  const miesiace = zakresMiesiecy(od <= biezacy ? od : biezacy, biezacy);
  return `<div class="miesiace" role="group" aria-label="Miesiąc">${miesiace.map((k) => {
    const [y, m] = k.split('-');
    const krotko = MIESIACE_KROTKO[Number(m) - 1];
    const tekst = `${krotko[0].toUpperCase()}${krotko.slice(1)}${y !== rokBiezacy ? ` ${y}` : ''}`;
    return `<button type="button" data-akcja="miesiac" data-wartosc="${k}" aria-pressed="${k === s.ui.miesiac}"
      aria-label="${esc(etykietaMiesiaca(k))}">${esc(tekst)}</button>`;
  }).join('')}</div>`;
}

/** Przewija pasek miesięcy tak, żeby wybrany był na środku (wywoływane w poRenderze). */
export function pokazWybranyMiesiac(root) {
  const btn = root.querySelector('.miesiace [aria-pressed="true"]');
  const pasek = btn?.parentElement;
  if (!btn || pasek.scrollWidth <= pasek.clientWidth) return;
  const b = btn.getBoundingClientRect();
  const p = pasek.getBoundingClientRect();
  pasek.scrollLeft += (b.left - p.left) - (p.width - b.width) / 2;
  // Szerokość przycisków zmienia się po wczytaniu czcionek – wtedy wyśrodkuj jeszcze raz.
  if (document.fonts?.status === 'loading') document.fonts.ready.then(() => pokazWybranyMiesiac(root));
}

/** Rozliczenia wszystkich klientów na dziś (rozliczenia.js; liczone raz na stan danych). */
export function rozliczeniaKlientow(s) {
  const u = ustawienia(s);
  return rozliczenia(s.dane, { dataStart: u.data_start, dzis: dzisiaj(), tolerancja: u.tolerance_days });
}

/** Pasek postępu (np. próg 100 000 zł, limit VAT). klasa: '' | 'czesciowo' | 'zalega'. */
export const pasekPostepu = (udzial, klasa = '') => `<div class="pasek-postepu ${klasa}" role="presentation">
  <span style="width:${Math.min(100, Math.max(0, udzial * 100)).toFixed(1)}%"></span></div>`;

/**
 * Próg wyższej stawki ryczałtu (6.3): przychód od początku roku na tle progu, data przekroczenia albo prognoza.
 * p – wynik podatek.progRoku().
 */
export function opisProgu(p, u) {
  const klasa = p.dataPrzekroczenia ? 'czesciowo' : '';
  let opis;
  if (p.dataPrzekroczenia) {
    opis = `<span class="status czesciowo">Od ${formatData(p.dataPrzekroczenia)} nadwyżka jest opodatkowana stawką ${formatProcentBp(u.tax_rate_high_bp)}</span>`;
  } else if (p.prognoza) {
    opis = `<span class="wyciszony">Prognoza przekroczenia: ${esc(etykietaMiesiaca(p.prognoza))} (${
      Math.ceil(Number(p.prognoza.slice(5)) / 3)}. kwartał) – średnia z 3 ostatnich pełnych miesięcy</span>`;
  } else opis = '<span class="wyciszony">W tym roku bez przekroczenia przy obecnym tempie</span>';
  return `<div class="limit">
    <p><strong>Próg ${formatZl(p.progGr, { grosze: false })}</strong> (stawka ${formatProcentBp(u.tax_rate_low_bp)} → ${
  formatProcentBp(u.tax_rate_high_bp)})<br>
      <span class="kwota">${formatZl(p.sumaGr)}</span> od początku roku (${Math.round(p.udzial * 100)}%)</p>
    ${pasekPostepu(p.udzial, klasa)}<p class="maly">${opis}</p></div>`;
}

/**
 * Karta „Terminowość” na karcie klienta (prośba 11.11: na razie wyłączona, z możliwością włączenia
 * w Ustawieniach → Karta klienta). Zapamiętane na tym urządzeniu (localStorage), bez migracji bazy.
 */
const KLUCZ_TERMINOWOSCI = 'najem.terminowoscKlienta';
export function pokazTerminowosc() {
  try { return localStorage.getItem(KLUCZ_TERMINOWOSCI) === '1'; } catch { return false; }
}
export function ustawTerminowosc(wlacz) {
  try { localStorage.setItem(KLUCZ_TERMINOWOSCI, wlacz ? '1' : '0'); } catch { /* tryb prywatny – zostaje domyślnie wyłączona */ }
}

/** Eksporty CSV (rozdz. 10) – wspólne dla Ustawień i Raportów. rodzaj: klienci | jednostki | wplaty | dluznicy | ryczalt. */
export const EKSPORTY = Object.freeze({
  klienci: 'Klienci',
  jednostki: 'Jednostki',
  wplaty: 'Wpłaty',
  dluznicy: 'Dłużnicy',
  koszty: 'Koszty',
  ryczalt: 'Ryczałt (PIT-28)',
});

export function pobierzEksport(s, rodzaj, { rok, od, do: doDnia } = {}) {
  const dzis = dzisiaj();
  const u = ustawienia(s);
  const o = { dzis, ustawienia: u };
  let wynik;
  let nazwa;
  if (rodzaj === 'klienci') [wynik, nazwa] = [eksportKlientow(s.dane, o), 'klienci'];
  else if (rodzaj === 'jednostki') [wynik, nazwa] = [eksportJednostek(s.dane, o), 'jednostki'];
  else if (rodzaj === 'wplaty') {
    wynik = eksportWplat(s.dane, rok ? { od: `${rok}-01-01`, do: `${rok}-12-31` } : {});
    nazwa = rok ? `wplaty_${rok}` : 'wplaty';
  } else if (rodzaj === 'koszty') {
    wynik = eksportKosztow(s.dane, { od, do: doDnia });
    nazwa = od && doDnia ? `koszty_${od}_${doDnia}` : 'koszty';
  } else if (rodzaj === 'dluznicy') [wynik, nazwa] = [eksportDluznikow(s.dane, o), 'dluznicy'];
  else if (rodzaj === 'ryczalt') {
    const r = rok ?? Number(dzis.slice(0, 4));
    // Osobne liczniki (Millennium, pozostałe konta, gotówka) jeden pod drugim, z kolumną „licznik”.
    wynik = { naglowek: ['licznik', ...NAGLOWEK_CSV], wiersze: GRUPY_RYCZALTU.flatMap((g) =>
      wierszeCsv(zestawienieRoku(daneGrupy(s.dane, g.id), { rok: r, dzis, ustawienia: u })).map((w) => [g.nazwa, ...w])) };
    nazwa = `ryczalt_${r}`;
  } else return;
  pobierzPlik(`${nazwa}_${dzis}.csv`, doCsv(wynik.naglowek, wynik.wiersze));
}

/**
 * Jednostki klienta do pola „Za jednostkę” (ręczne przypisanie wpłaty, payments.rental_id).
 * Pusta lista, gdy klient ma mniej niż 2 najmy – wtedy pola nie pokazujemy (i tak wszystko idzie na ten jeden najem).
 */
export function opcjeNajmowKlienta(s, klientId) {
  const najmy = s.indeksy.najmyKlienta.get(klientId) ?? [];
  if (najmy.length < 2) return [];
  return [...najmy].sort((a, b) => (a.end_on != null) - (b.end_on != null)
    || (s.indeksy.jednostki.get(a.unit_id)?.code ?? '').localeCompare(s.indeksy.jednostki.get(b.unit_id)?.code ?? '', 'pl', { numeric: true }))
    .map((n) => ({ wartosc: n.id, tekst: `${s.indeksy.jednostki.get(n.unit_id)?.code ?? '?'}${n.end_on ? ` (zakończony ${n.end_on})` : ''}` }));
}

/**
 * rental_id do zapisu: bez klucza, gdy puste i wcześniej też puste – zapis działa wtedy także bez migracji 006.
 * Zwraca obiekt do rozłożenia w wierszu zapisu.
 */
export function poleNajmu(rentalId, poprzednia = null) {
  if (rentalId) return { rental_id: rentalId };
  return poprzednia?.rental_id ? { rental_id: null } : {};
}
