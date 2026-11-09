// Import wyciągu (8.3): start (konto i plik), podgląd (7.3), wynik zapisu.
// Odczyt CSV, profile banków i rozpoznanie płatnika – krok 1b (csv.js, banki.js, rozliczenia.js).

import { ostatniaWplataNaKoncie } from '../dane.js';
import { pustyStan, wPlanie } from '../ui.js';
import { esc, formatData, dataZeZnacznika } from '../utils.js';

const LICZBA_OSTATNICH = 10;

function wyborPliku(konta) {
  return `<form class="karta" data-formularz="wyciag" aria-labelledby="imp-tytul">
    <h2 id="imp-tytul">Wczytaj wyciąg CSV</h2>
    <div class="pole">
      <label for="imp-konto">Konto</label>
      <select id="imp-konto" name="konto" required>
        ${konta.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}
      </select>
    </div>
    <div class="pole">
      <label for="imp-plik">Plik z banku</label>
      <input id="imp-plik" name="plik" type="file" accept=".csv,text/csv" aria-describedby="imp-plik-opis" disabled>
      <p id="imp-plik-opis" class="wyciszony maly">Plik zostaje na tym urządzeniu – do bazy trafiają tylko wpływy.</p>
    </div>
    ${wPlanie('Odczyt pliku, podgląd z przypisaniem klientów i zapis – krok 1b.')}
  </form>`;
}

function ostatnieImporty(s) {
  const ostatnieWplaty = ostatniaWplataNaKoncie(s.dane.payments);
  const naKontach = s.dane.bank_accounts.filter((k) => !k.archived).map((k) => `<li><div class="wiersz">
      <div class="glowna"><strong>${esc(k.name)}</strong></div>
      <div class="prawa maly">${ostatnieWplaty.has(k.id)
        ? `ostatnia wpłata ${formatData(ostatnieWplaty.get(k.id))}` : '<span class="wyciszony">brak wpłat</span>'}</div>
    </div></li>`).join('');

  const importy = [...s.dane.imports]
    .sort((a, b) => b.imported_at.localeCompare(a.imported_at)).slice(0, LICZBA_OSTATNICH)
    .map((i) => `<li><div class="wiersz"><div class="glowna">
        <strong>${esc(i.file_name ?? 'wyciąg')}</strong>
        <span>${formatData(dataZeZnacznika(i.imported_at))} · ${esc(s.indeksy.konta.get(i.bank_account_id)?.name ?? 'konto usunięte')}</span></div>
      <div class="prawa maly">${i.rows_added ?? 0} nowych</div></div></li>`).join('');

  return `<section class="karta" aria-labelledby="imp-konta"><h2 id="imp-konta">Konta</h2>
      <ul class="lista">${naKontach}</ul></section>
    <section class="karta" aria-labelledby="imp-historia"><h2 id="imp-historia">Ostatnie importy</h2>
      ${importy ? `<ul class="lista">${importy}</ul>` : '<p class="wyciszony">Nie wczytano jeszcze żadnego wyciągu.</p>'}</section>`;
}

export default {
  tytul: () => 'Import wyciągu',
  wstecz: () => ({ href: '#/wplaty', tekst: 'Wpłaty' }),

  render(s) {
    const konta = s.dane.bank_accounts.filter((k) => !k.archived);
    if (!konta.length) {
      return pustyStan('Najpierw dodaj konto bankowe, z którego pochodzi wyciąg.', [
        { tekst: 'Przejdź do Ustawień', href: '#/ustawienia' }]);
    }
    return `<div class="siatka">${wyborPliku(konta)}<div class="stos">${ostatnieImporty(s)}</div></div>`;
  },

  formularze: {
    wyciag: (_form, ctx) => ctx.toast('Import wyciągu – krok 1b.'),
  },
};
