// Raporty (rozdz. 9): wybór okresu u góry i 8 kart. Wyliczenia – krok 1d (statystyki.js, podatek.js).

import { pelneMiesiaceWplat } from '../dane.js';
import { filtry, pustyStan, wPlanie } from '../ui.js';
import { dzisiaj } from '../utils.js';

const MIN_PELNYCH_MIESIECY = 2;   // 9 i 12.3

const OKRESY = [
  { id: 'miesiac', tekst: 'Miesiąc' },
  { id: 'kwartal', tekst: 'Kwartał' },
  { id: 'rok', tekst: 'Rok' },
  { id: '12m', tekst: 'Ostatnie 12 miesięcy' },
  { id: 'wlasny', tekst: 'Własny zakres' },
];

/** Karty z tabeli w rozdziale 9: [id, tytuł, zawartość]. */
const KARTY = [
  ['przychod', 'Przychód', 'Wpłynęło, należne, ściągalność, średnio na miesiąc; słupki miesięcy.'],
  ['terminowosc', 'Terminowość', 'Odsetek terminowych należności, średnie opóźnienie, rankingi 10 klientów.'],
  ['dluznicy', 'Dłużnicy', 'Ranking według kwoty i dni po terminie, tabela wiekowania, obietnice zapłaty.'],
  ['brakujace', 'Brakujące wpłaty', 'Oczekiwane przelewy, zapłacone w terminie, spóźnione, brakujące.'],
  ['oblozenie', 'Obłożenie', 'Odsetek zajętych jednostek według typu, wolne jednostki, stawka za m².'],
  ['jednostki', 'Przychód według jednostek', '10 jednostek z najwyższym przychodem, udział typów.'],
  ['podatek', 'Podatek', 'Kwartały: przychód, narastająco, ryczałt, termin, status; progi 100 000 zł i 240 000 zł.'],
  ['lata', 'Porównanie lat', 'Od 2027 r.: przychód, ściągalność, terminowość i obłożenie rok do roku.'],
];

export default {
  tytul: () => 'Raporty',

  render(s) {
    if (pelneMiesiaceWplat(s.dane.payments, dzisiaj()) < MIN_PELNYCH_MIESIECY) {
      return pustyStan('Raporty pojawią się po drugim pełnym miesiącu wpłat.');
    }
    const okres = s.ui.filtry.raporty ?? 'miesiac';
    return `
      ${filtry(OKRESY, okres, 'Okres raportu')}
      <div class="siatka">${KARTY.map(([id, tytul, opis]) => `
        <section class="karta" aria-labelledby="r-${id}"><h2 id="r-${id}">${tytul}</h2>
          ${wPlanie(`${opis} Krok 1d.`)}</section>`).join('')}
      </div>`;
  },
};
