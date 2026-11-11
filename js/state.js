// Jeden obiekt stanu aplikacji (jak w Budżecie). Widoki tylko go czytają;
// zmiany robi app.js i akcje widoków, po czym wywołują render().

import { TABELE } from './config.js';
import { zbudujIndeksy } from './dane.js';
import { dzisiaj, kluczMiesiaca } from './utils.js';

/** Pusty komplet danych: tablica na każdą tabelę, ustawienia jako pojedynczy obiekt. */
export function pusteDane() {
  const dane = Object.fromEntries(TABELE.map((t) => [t, []]));
  dane.settings = null;
  return dane;
}

/** Podmienia dane i przelicza indeksy (Z38: wszystko liczone przy odczycie). */
export function ustawDane(dane) {
  state.dane = dane;
  state.indeksy = zbudujIndeksy(dane);
}

export const state = {
  faza: 'start',               // start | logowanie | aplikacja
  podglad: false,              // brak konfiguracji Supabase – interfejs bez bazy
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  uzytkownik: null,            // { id, email }
  ladowanie: false,
  blad: null,                  // komunikat błędu pobierania danych
  zKopii: null,                // znacznik czasu kopii z IndexedDB, gdy dane pochodzą z urządzenia (tylko odczyt)
  dane: pusteDane(),
  indeksy: zbudujIndeksy(pusteDane()),   // przeliczane w ustawDane()
  ui: {
    ekran: 'pulpit',
    parametr: null,            // np. id klienta w #/klienci/<id>
    akcja: null,               // np. 'edycja' w #/klienci/<id>/edycja
    zapytanie: {},             // np. { jednostka: '<id>' } z #/najmy/nowy?jednostka=<id>
    adres: '',                 // ostatni location.hash – wykrywa przejście na inny ekran
    form: null,                // stan otwartego formularza (js/formularz.js)
    miesiac: kluczMiesiaca(dzisiaj()),
    filtry: {},                // { [ekran]: 'nazwa-filtra' }
    edycja: false,             // tryb edycji ekranu: rzadziej używane opcje widoczne po „Edytuj”; zeruje się przy zmianie adresu
    szukaj: {},                // { [ekran]: 'tekst' }
  },
};
