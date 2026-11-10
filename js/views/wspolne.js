// Fragmenty używane przez kilka widoków.

import { DOMYSLNE_USTAWIENIA } from '../config.js';
import { rozliczenia } from '../rozliczenia.js';
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
