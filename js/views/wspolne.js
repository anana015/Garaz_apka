// Fragmenty używane przez kilka widoków.

import { DOMYSLNE_USTAWIENIA } from '../config.js';
import { esc, dzisiaj, kluczMiesiaca, zakresMiesiecy, etykietaMiesiaca, MIESIACE_KROTKO } from '../utils.js';

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
