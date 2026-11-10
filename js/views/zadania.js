// Zadania: wszystkie notatki klientów z terminem – moje i klientów (np. obietnice zapłaty).
// Adres: #/zadania. Filtry: Do zrobienia, Moje, Klientów, Zrobione. Klik w wiersz → karta klienta.

import { filtry, pustyStan } from '../ui.js';
import { dataZeZnacznika, esc, dzisiaj, formatData, formatZl, roznicaDni } from '../utils.js';
import { grupaTerminu, KTO, RODZAJE_NOTATEK, zadania } from '../zadania.js';

const FILTRY = {
  'do-zrobienia': { tekst: 'Do zrobienia', warunek: () => true },
  moje: { tekst: 'Moje', warunek: (n) => n.task_owner !== 'klient' },
  klienta: { tekst: 'Klientów', warunek: (n) => n.task_owner === 'klient' },
  zrobione: { tekst: 'Zrobione', warunek: () => true },
};

const GRUPY = { zalegle: 'Po terminie', dzis: 'Dziś', tydzien: 'W ciągu 7 dni', pozniej: 'Później' };
const dni = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

function wiersz(n, s, dzis) {
  const klient = s.indeksy.klienci.get(n.client_id);
  const roznica = roznicaDni(dzis, n.promised_on);
  const stan = n.done_at ? `<span class="status ok">zrobione ${formatData(dataZeZnacznika(n.done_at))}</span>`
    : roznica < 0 ? `<span class="status zalega">${dni(-roznica)} po terminie</span>`
      : roznica === 0 ? '<span class="status czesciowo">dziś</span>'
        : `<span class="wyciszony">za ${dni(roznica)}</span>`;
  const kwota = n.promised_gr ? ` · ${formatZl(n.promised_gr)}` : '';
  return `<li class="zadanie${n.done_at ? ' zrobione' : ''}"><div class="wiersz">
    <a class="glowna" href="#/klienci/${encodeURIComponent(n.client_id)}">
      <strong>${esc(klient?.name ?? 'klient usunięty')}</strong>
      <span>${formatData(n.promised_on)} · ${esc(RODZAJE_NOTATEK[n.kind] ?? n.kind)}${kwota} ·
        <span class="chip">${KTO[n.task_owner ?? 'ja']}</span></span>
      <span class="tekst-notatki">${esc(n.body)}</span></a>
    <div class="prawa"><div class="maly">${stan}</div>
      <button type="button" class="przycisk drugi maly" data-akcja="zadanie-zrobione" data-id="${esc(n.id)}"
        data-zrobione="${n.done_at ? '' : '1'}">${n.done_at ? 'Przywróć' : 'Zrobione'}</button></div>
  </div></li>`;
}

export default {
  tytul: () => 'Zadania',

  render(s) {
    const filtr = s.ui.filtry.zadania ?? 'do-zrobienia';
    const dzis = dzisiaj();
    const lista = zadania(s.dane.client_notes, { zrobione: filtr === 'zrobione' })
      .filter((n) => FILTRY[filtr].warunek(n));
    const opcjeFiltra = Object.entries(FILTRY).map(([id, f]) => ({ id, tekst: f.tekst }));
    const naglowek = `${filtry(opcjeFiltra, filtr, 'Rodzaj zadań')}
      <p class="podpowiedz">Zadanie to notatka klienta z terminem. Dodasz je na karcie klienta: „Dodaj notatkę” i wpisz termin.</p>`;

    if (!lista.length) {
      return naglowek + pustyStan(filtr === 'zrobione' ? 'Brak zrobionych zadań.' : 'Nie ma zadań do zrobienia.',
        [{ tekst: 'Przejdź do klientów', href: '#/klienci' }]);
    }

    if (filtr === 'zrobione') {
      const zrobione = lista.sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 100);
      return `${naglowek}<section class="karta"><ul class="lista">${zrobione.map((n) => wiersz(n, s, dzis)).join('')}</ul></section>`;
    }

    lista.sort((a, b) => a.promised_on.localeCompare(b.promised_on) || a.created_at.localeCompare(b.created_at));
    const sekcje = Object.entries(GRUPY).map(([id, tytul]) => {
      const w = lista.filter((n) => grupaTerminu(n.promised_on, dzis) === id);
      return w.length ? `<section class="karta" aria-labelledby="z-${id}">
        <h2 id="z-${id}">${tytul} <span class="wyciszony">(${w.length})</span></h2>
        <ul class="lista">${w.map((n) => wiersz(n, s, dzis)).join('')}</ul></section>` : '';
    }).join('');
    return naglowek + sekcje;
  },

};
