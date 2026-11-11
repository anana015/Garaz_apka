// Walidacja formularzy (8.6) i budowa wierszy do zapisu. Czyste funkcje – tests/walidacja.test.js.
// Wejście: wartości pól jako tekst (jak z FormData). Wyjście: { bledy, … }, gdzie
// bledy = { [nazwaPola]: 'komunikat' } – widok pokazuje je pod polami (12.5).
// Gdy bledy jest pusty, wynik zawiera gotowy wiersz albo pakiet dla db.zapiszPakiet().

import { TYPY_JEDNOSTEK, bezKaucji } from './config.js';
import { MIEJSCA_PLATNOSCI, stawkaNaDzien } from './dane.js';
import { doPelnychZlotych, naleznosciNajmu, pierwszyOkresOd } from './okresy.js';
import {
  czytajDate, dodajDni, formatData, formatZl, normalizujTekst, noweId as losoweId, oczyscNip, oczyscRachunek,
  parseKwota, walidujEmail, walidujNip, walidujTelefon,
} from './utils.js';

export const LIMIT_PDF = 10 * 1024 * 1024;   // 8.6: PDF do 10 MB
export const BANKI = Object.freeze({ nest: 'Nest Bank', pekao: 'Pekao', pko: 'PKO BP', alior: 'Alior', millennium: 'Millennium', inny: 'Inny bank' });
export const OKRESY_ROZLICZENIOWE = Object.freeze([1, 3, 6, 12]);
export const TRYBY_STAWKI = Object.freeze({ kwota: 'Nowa kwota', procent: '+ procent', zl: '+ kwota' });
export const POWODY_ZATRZYMANIA = Object.freeze({
  czynsz: 'Zaległy czynsz',     // wpłata „czynsz” metodą „kaucja” – zmniejsza zaległość (Z26)
  szkody: 'Szkody',             // wpłata „przychod_inny” – przychód, ale nie saldo czynszu
});

// ---------------------------------------------------------------------
// Odczyt pól
// ---------------------------------------------------------------------

const tekst = (v) => String(v ?? '').trim();
const lubNull = (v) => tekst(v) || null;
const bezBledow = (bledy) => Object.keys(bledy).length === 0;
/** Pole wyboru z FormData: „on”, gdy zaznaczone. */
export const zaznaczone = (v) => v === 'on' || v === true || v === 'true';

function liczbaCalkowita(v) {
  const s = tekst(v);
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

function data(w, pole, bledy, { wymagana = false, etykieta = 'datę' } = {}) {
  const s = tekst(w[pole]);
  if (!s) {
    if (wymagana) bledy[pole] = `Podaj ${etykieta}.`;
    return null;
  }
  const d = czytajDate(s);
  if (!d) bledy[pole] = 'Nieprawidłowa data.';
  return d;
}

/** Kwota w groszach. dodatnia: > 0, nieujemna: ≥ 0. */
function kwota(w, pole, bledy, { wymagana = false, dodatnia = false, nieujemna = false, etykieta = 'kwotę' } = {}) {
  const s = tekst(w[pole]);
  if (!s) {
    if (wymagana) bledy[pole] = `Podaj ${etykieta}.`;
    return null;
  }
  const gr = parseKwota(s);
  if (gr == null) bledy[pole] = 'Wpisz kwotę, np. 300 albo 300,50.';
  else if (dodatnia && gr <= 0) bledy[pole] = 'Kwota musi być większa od zera.';
  else if (nieujemna && gr < 0) bledy[pole] = 'Kwota nie może być ujemna.';
  return gr;
}

/** Procent jako punkty bazowe: "8,5" → 850. */
function procentBp(w, pole, bledy) {
  const bp = parseKwota(tekst(w[pole]).replace(/%$/, ''));
  if (bp == null || bp < 0 || bp > 10000) {
    bledy[pole] = 'Podaj procent od 0 do 100, np. 8,5.';
    return null;
  }
  return bp;
}

function calkowitaWZakresie(w, pole, bledy, od, doWartosci, komunikat) {
  const n = liczbaCalkowita(w[pole]);
  if (n == null || n < od || n > doWartosci) bledy[pole] = komunikat;
  return n;
}

// ---------------------------------------------------------------------
// Jednostka
// ---------------------------------------------------------------------

/**
 * @param {object} w pola: code, type, area_m2, list_price_gr, description, out_of_service
 * @param {{ jednostki?: Array, id?: string|null, wynajeta?: boolean }} kontekst
 *   jednostki – wszystkie (także zarchiwizowane: numer jest unikalny w bazie), id – edytowana,
 *   wynajeta – jednostka ma dziś najem (nie można jej wyłączyć z najmu)
 */
export function walidujJednostke(w, { jednostki = [], id = null, wynajeta = false } = {}) {
  const bledy = {};
  const code = tekst(w.code).replace(/\s+/g, ' ').toUpperCase();
  if (!code) bledy.code = 'Podaj numer jednostki, np. G-03.';
  else if (code.length > 12) bledy.code = 'Numer może mieć najwyżej 12 znaków.';
  else if (jednostki.some((j) => j.id !== id && j.code.toUpperCase() === code)) bledy.code = `Jednostka ${code} już istnieje.`;

  if (!TYPY_JEDNOSTEK[w.type]) bledy.type = 'Wybierz typ jednostki.';

  let area = null;
  if (tekst(w.area_m2)) {
    area = Number(tekst(w.area_m2).replace(/\s|m2|m²/gi, '').replace(',', '.'));
    if (!Number.isFinite(area) || area <= 0 || area >= 10000) {
      bledy.area_m2 = 'Podaj powierzchnię w m², np. 12,5.';
      area = null;
    } else area = Math.round(area * 100) / 100;
  }

  const cena = kwota(w, 'list_price_gr', bledy, { nieujemna: true });
  const wylaczona = zaznaczone(w.out_of_service);
  if (wylaczona && wynajeta) bledy.out_of_service = 'Jednostka jest wynajęta. Najpierw zakończ najem.';

  return {
    bledy,
    wiersz: {
      code, type: w.type, area_m2: area, list_price_gr: cena,
      description: lubNull(w.description), out_of_service: wylaczona,
    },
  };
}

// ---------------------------------------------------------------------
// Klient
// ---------------------------------------------------------------------

/**
 * @param {object} w pola: kind, name, contact_person, nip, address, phone, email, note, opening_balance_gr
 * @param {{ klienci?: Array, id?: string|null }} kontekst
 */
export const TYPY_DOKUMENTU = Object.freeze({
  dowod: 'Dowód osobisty', paszport: 'Paszport', karta_pobytu: 'Karta pobytu', inny: 'Inny dokument',
});

/** PESEL: 11 cyfr z poprawną cyfrą kontrolną (wagi 1-3-7-9). */
export function walidujPesel(tekstPesel) {
  const p = String(tekstPesel ?? '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(p)) return false;
  const wagi = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const suma = wagi.reduce((x, wg, i) => x + wg * Number(p[i]), 0);
  return (10 - (suma % 10)) % 10 === Number(p[10]);
}

/**
 * kontekst.wymagajKontaktu – formularz klienta (prośba 11.11): telefon, e-mail i adres obowiązkowe.
 * Import danych startowych tego nie wymaga (stare dane bywają niepełne).
 */
export function walidujKlienta(w, { klienci = [], id = null, wymagajKontaktu = false } = {}) {
  const bledy = {};
  const kind = w.kind === 'firma' ? 'firma' : 'osoba';
  const name = tekst(w.name).replace(/\s+/g, ' ');
  if (!name) bledy.name = kind === 'firma' ? 'Podaj nazwę firmy.' : 'Podaj imię i nazwisko.';
  else if (name.length > 80) bledy.name = 'Najwyżej 80 znaków.';

  let nip = null;
  if (tekst(w.nip)) {
    if (!walidujNip(w.nip)) bledy.nip = 'NIP musi mieć 10 cyfr z poprawną sumą kontrolną.';
    else {
      nip = oczyscNip(w.nip);
      const inny = klienci.find((k) => k.id !== id && k.nip === nip);
      if (inny) bledy.nip = `Ten NIP ma już klient ${inny.name}.`;
    }
  }
  const phone = lubNull(w.phone);
  if (phone && !walidujTelefon(phone)) bledy.phone = 'Telefon: 9 cyfr albo z prefiksem +48.';
  const email = lubNull(w.email);
  if (email && !walidujEmail(email)) bledy.email = 'Nieprawidłowy adres e-mail.';
  const saldo = kwota(w, 'opening_balance_gr', bledy) ?? 0;
  const address = lubNull(w.address);
  if (wymagajKontaktu) {
    if (!phone) bledy.phone = 'Podaj telefon.';
    if (!email) bledy.email = 'Podaj adres e-mail.';
    if (!address) bledy.address = 'Podaj adres.';
  }

  // Dokument tożsamości i PESEL (prośba 11.11) – tylko osoba; pola opcjonalne.
  const docType = kind === 'osoba' && TYPY_DOKUMENTU[w.doc_type] ? w.doc_type : null;
  const docNumber = kind === 'osoba' ? lubNull(String(w.doc_number ?? '').toUpperCase().replace(/\s+/g, ' ')) : null;
  if (docNumber && docNumber.length > 30) bledy.doc_number = 'Najwyżej 30 znaków.';
  if (docNumber && !docType) bledy.doc_type = 'Wybierz typ dokumentu.';
  let pesel = null;
  if (kind === 'osoba' && tekst(w.pesel)) {
    pesel = tekst(w.pesel).replace(/\s/g, '');
    if (!walidujPesel(pesel)) bledy.pesel = 'PESEL musi mieć 11 cyfr z poprawną cyfrą kontrolną.';
    else {
      const inny = klienci.find((k) => k.id !== id && k.pesel === pesel);
      if (inny) bledy.pesel = `Ten PESEL ma już klient ${inny.name}.`;
    }
  }

  const wiersz = {
    kind, name, nip, phone, email, opening_balance_gr: saldo,
    contact_person: lubNull(w.contact_person), address, note: lubNull(w.note),
  };
  // Kolumny z migracji 009 – wysyłane tylko z formularza (import działa też bez migracji).
  if (wymagajKontaktu) Object.assign(wiersz, { doc_type: docType, doc_number: docNumber, pesel });
  return { bledy, wiersz };
}

// ---------------------------------------------------------------------
// Nowy najem
// ---------------------------------------------------------------------

/**
 * Najem, z którym koliduje nowy najem bez daty końca od dnia `start` (Z1, test 16):
 * każdy najem tej jednostki, który trwa w dniu startu albo zaczyna się później.
 */
export function kolizjaNajmu(najmyJednostki = [], start, pominId = null) {
  return najmyJednostki.find((n) => n.id !== pominId && (n.end_on == null || n.end_on >= start)) ?? null;
}

function opisKolizji(kolizja, start, kod, indeksy) {
  const klient = indeksy.klienci.get(indeksy.umowy.get(kolizja.contract_id)?.client_id);
  const kto = klient ? ` (${klient.name})` : '';
  const okres = `od ${formatData(kolizja.start_on)}${kolizja.end_on ? ` do ${formatData(kolizja.end_on)}` : ''}`;
  if (kolizja.end_on && kolizja.start_on <= start) {
    return `Jednostka ${kod} jest wynajęta ${okres}${kto}. Nowy najem może zacząć się najwcześniej ${formatData(dodajDni(kolizja.end_on, 1))}.`;
  }
  if (!kolizja.end_on && kolizja.start_on <= start) {
    return `Jednostka ${kod} jest wynajęta ${okres}${kto}. Najpierw zakończ tamten najem.`;
  }
  return `Jednostka ${kod} ma już najem ${okres}${kto}, a nowy najem nie ma daty końca.`;
}

/** Plik PDF umowy: typ i rozmiar (8.6). */
export function walidujPdf(plik) {
  if (!plik || !plik.size) return null;
  if (plik.type !== 'application/pdf' && !/\.pdf$/i.test(plik.name ?? '')) return 'Plik musi być w formacie PDF.';
  if (plik.size > LIMIT_PDF) return 'PDF może mieć najwyżej 10 MB.';
  return null;
}

/**
 * @param {object} w pola: client_id, unit_id, number, signed_on, start_on, valid_until, notice_period,
 *   amount_gr, billing_day, period_months, last_period, deposit_gr, deposit_method, deposit_on
 * @param {{ indeksy: object, ustawienia: object, plik?: {name,size,type}|null, noweId?: () => string }} kontekst
 * @returns {{ bledy, pakiet?, umowaId?, najemId?, istniejacaUmowa? }}
 */
export function walidujNajem(w, { indeksy, ustawienia, plik = null, noweId = losoweId, przejmowany = null }) {
  const bledy = {};
  const klient = indeksy.klienci.get(w.client_id);
  if (!klient) bledy.client_id = 'Wybierz klienta.';
  else if (klient.archived) bledy.client_id = 'Klient jest zarchiwizowany.';

  const jednostka = indeksy.jednostki.get(w.unit_id);
  if (!jednostka) bledy.unit_id = 'Wybierz jednostkę.';
  else if (jednostka.archived || jednostka.out_of_service) bledy.unit_id = `Jednostka ${jednostka.code} jest wyłączona z najmu.`;

  const start = data(w, 'start_on', bledy, { wymagana: true, etykieta: 'datę startu' });
  const podpisana = data(w, 'signed_on', bledy);
  const umowaDo = data(w, 'valid_until', bledy);
  if (start && umowaDo && umowaDo < start) bledy.valid_until = 'Umowa nie może kończyć się przed startem najmu.';

  if (jednostka && start && !bledy.unit_id) {
    // przejmowany – najem obecnego najemcy, który kończy się dzień przed startem (widok ustawia mu end_on przed zapisem).
    const kolizja = kolizjaNajmu(indeksy.najmyJednostki.get(jednostka.id), start, przejmowany?.id ?? null);
    if (kolizja) bledy.unit_id = opisKolizji(kolizja, start, jednostka.code, indeksy);
  }

  const stawka = kwota(w, 'amount_gr', bledy, { wymagana: true, dodatnia: true, etykieta: 'stawkę' });
  // Dzień płatności: podpowiedź z daty startu (8.6), więc puste pole = dzień startu.
  const dzien = tekst(w.billing_day) === '' ? (ustawienia.default_billing_day ?? 20) : liczbaCalkowita(w.billing_day);
  if (dzien == null || dzien < 1 || dzien > 31) bledy.billing_day = 'Dzień płatności: liczba od 1 do 31.';
  const okres = Number(w.period_months || 1);
  if (!OKRESY_ROZLICZENIOWE.includes(okres)) bledy.period_months = 'Wybierz okres rozliczeniowy.';
  const ostatni = ['proporcjonalnie', 'pelny'].includes(w.last_period) ? w.last_period : ustawienia.default_last_period;

  // Boxy bez kaucji (prośba 11.11) – pola kaucji pomijane, nawet jeśli coś w nich zostało.
  const kaucja = jednostka && bezKaucji(jednostka.type) ? null : kwota(w, 'deposit_gr', bledy, { dodatnia: true });
  const kaucjaData = kaucja ? (data(w, 'deposit_on', bledy) ?? podpisana ?? start) : null;
  const bladPdf = walidujPdf(plik);
  if (bladPdf) bledy.pdf = bladPdf;
  const platnosc = walidujMiejscePlatnosci(w, { konta: indeksy.konta, wymagajKonta: true });
  Object.assign(bledy, platnosc.bledy);

  if (!bezBledow(bledy)) return { bledy };

  // Ten sam numer umowy u tego klienta = kolejna jednostka w istniejącej umowie (umowa obejmuje kilka jednostek).
  const numer = lubNull(w.number);
  const istniejaca = numer ? [...indeksy.umowy.values()].find((u) => u.client_id === klient.id && !u.archived
    && normalizujTekst(u.number) === normalizujTekst(numer)) ?? null : null;
  const umowaId = istniejaca?.id ?? noweId();
  const najemId = noweId();

  const pakiet = {
    contracts: istniejaca ? [] : [{
      id: umowaId, client_id: klient.id, number: numer, signed_on: podpisana, valid_until: umowaDo,
      notice_period: lubNull(w.notice_period),
    }],
    rentals: [{
      id: najemId, contract_id: umowaId, unit_id: jednostka.id, start_on: start,
      billing_day: dzien, period_months: okres, last_period: ostatni,
    }],
    rental_rates: [{ rental_id: najemId, valid_from: start, amount_gr: stawka, reason: 'start' }],
    deposits: kaucja ? [{
      contract_id: umowaId, kind: 'przyjecie', amount_gr: kaucja,
      method: w.deposit_method === 'przelew' ? 'przelew' : 'gotowka', on_date: kaucjaData,
    }] : [],
  };
  // Miejsce płatności zapisuje widok osobno (funkcja zapisz_pakiet z migracji 001 nie zna tych kolumn).
  return { bledy, pakiet, umowaId, najemId, istniejacaUmowa: istniejaca, platnosc: platnosc.wiersz };
}

// ---------------------------------------------------------------------
// Zmiana stawki: jeden najem albo wiele naraz (8.6, Z12, Z13)
// ---------------------------------------------------------------------

/**
 * Nowa stawka w groszach.
 * tryb 'kwota': wartosc to nowa stawka; 'procent': wartosc w setnych procenta (5,5% → 550); 'zl': + wartosc.
 * nowaStawka(30000, 'procent', 1000, true) → 33000; nowaStawka(31500, 'procent', 500, true) → 33100 (330,75 → 331)
 */
export function nowaStawka(staraGr, tryb, wartosc, zaokraglij = true) {
  let gr;
  if (tryb === 'procent') gr = Math.round((staraGr * (10000 + wartosc)) / 10000);
  else if (tryb === 'zl') gr = staraGr + wartosc;
  else gr = wartosc;
  return zaokraglij ? doPelnychZlotych(gr) : gr;
}

/** Wspólne pola zmiany stawki: valid_from, tryb, wartosc, zaokraglij, reason. */
function czytajZmiane(w, bledy) {
  const od = data(w, 'valid_from', bledy, { wymagana: true, etykieta: 'datę, od której obowiązuje stawka' });
  const tryb = TRYBY_STAWKI[w.tryb] ? w.tryb : 'kwota';
  const s = tekst(w.wartosc).replace(/%$/, '');
  const wartosc = parseKwota(s);
  if (!s) bledy.wartosc = tryb === 'kwota' ? 'Podaj nową stawkę.' : 'Podaj wartość zmiany.';
  else if (wartosc == null) bledy.wartosc = tryb === 'procent' ? 'Wpisz procent, np. 5 albo 5,5.' : 'Wpisz kwotę, np. 330.';
  else if (tryb === 'kwota' && wartosc <= 0) bledy.wartosc = 'Stawka musi być większa od zera.';
  return { od, tryb, wartosc, zaokraglij: zaznaczone(w.zaokraglij), powod: lubNull(w.reason) };
}

/**
 * Podgląd zmiany dla jednego najmu: stara i nowa stawka, pierwszy okres z nową stawką (Z13).
 * @returns {{ najem, staraGr, nowaGr, pierwszyOkres, zastepuje, blad }}
 */
export function przeliczZmiane(najem, stawki = [], zmiana) {
  const wynik = { najem, staraGr: null, nowaGr: null, pierwszyOkres: null, zastepuje: false, blad: null };
  if (zmiana.od < najem.start_on) {
    wynik.blad = `Data przed startem najmu (${formatData(najem.start_on)}).`;
    return wynik;
  }
  // Stawka sprzed zmiany: obowiązująca dzień przed „od” (gdy „od” ma już stawkę, nowa ją zastąpi).
  wynik.zastepuje = stawki.some((s) => s.valid_from === zmiana.od);
  wynik.staraGr = stawkaNaDzien(stawki.filter((s) => s.valid_from !== zmiana.od), zmiana.od);
  if (wynik.staraGr == null && zmiana.tryb !== 'kwota') {
    wynik.blad = 'Najem nie ma stawki, od której można liczyć zmianę.';
    return wynik;
  }
  wynik.nowaGr = nowaStawka(wynik.staraGr, zmiana.tryb, zmiana.wartosc, zmiana.zaokraglij);
  if (wynik.nowaGr <= 0) wynik.blad = 'Nowa stawka musi być większa od zera.';
  wynik.pierwszyOkres = pierwszyOkresOd(najem, zmiana.od);
  if (!wynik.pierwszyOkres && !wynik.blad) wynik.blad = `Najem kończy się ${formatData(najem.end_on)}, przed pierwszym okresem z nową stawką.`;
  return wynik;
}

const wierszStawki = (p, zmiana) => ({
  rental_id: p.najem.id, valid_from: zmiana.od, amount_gr: p.nowaGr,
  reason: zmiana.powod ?? (p.staraGr != null && p.nowaGr < p.staraGr ? 'obniżka' : 'podwyżka'),
});

/** Zmiana stawki jednego najmu. @returns {{ bledy, podglad?, wiersz? }} */
export function walidujZmianeStawki(w, { najem, stawki = [] }) {
  const bledy = {};
  const zmiana = czytajZmiane(w, bledy);
  if (!bezBledow(bledy)) return { bledy };
  const podglad = przeliczZmiane(najem, stawki, zmiana);
  if (podglad.blad) {
    bledy[podglad.blad.startsWith('Data') || podglad.blad.startsWith('Najem kończy') ? 'valid_from' : 'wartosc'] = podglad.blad;
    return { bledy, podglad };
  }
  return { bledy, podglad, wiersz: wierszStawki(podglad, zmiana) };
}

/**
 * Zbiorcza zmiana stawek (podwyżka wielu najmów naraz).
 * @param {object} w pola jak walidujZmianeStawki + najmy: tablica id zaznaczonych najmów
 * @param {{ najmy: Array, stawkiNajmu: Map }} kontekst najmy – kandydaci (trwające w dniu „od” lub później)
 * @returns {{ bledy, pozycje: Array, wiersze: Array }} pozycje – podgląd wszystkich kandydatów
 */
export function walidujPodwyzke(w, { najmy, stawkiNajmu }) {
  const bledy = {};
  const zmiana = czytajZmiane(w, bledy);
  const zaznaczoneId = new Set([].concat(w.najmy ?? []));
  if (!zaznaczoneId.size) bledy.najmy = 'Zaznacz co najmniej jeden najem.';
  if (bledy.valid_from || bledy.wartosc) return { bledy, pozycje: [], wiersze: [] };

  const pozycje = najmy.map((n) => ({ ...przeliczZmiane(n, stawkiNajmu.get(n.id) ?? [], zmiana), zaznaczony: zaznaczoneId.has(n.id) }));
  const wybrane = pozycje.filter((p) => p.zaznaczony);
  if (wybrane.some((p) => p.blad)) bledy.najmy = 'Część zaznaczonych najmów ma błąd – odznacz je albo zmień datę.';
  const wiersze = bezBledow(bledy) ? wybrane.map((p) => wierszStawki(p, zmiana)) : [];
  return { bledy, pozycje, wiersze };
}

// ---------------------------------------------------------------------
// Zakończenie najmu (8.6) z rozliczeniem kaucji (Z25, Z26)
// ---------------------------------------------------------------------

/** Kaucja umowy: przyjęta − zwrócona − zatrzymana (grosze) i forma przyjęcia. */
export function saldoKaucji(deposits = [], umowaId) {
  let saldo = 0;
  let metoda = 'gotowka';
  for (const d of deposits) {
    if (d.contract_id !== umowaId) continue;
    if (d.kind === 'przyjecie') { saldo += d.amount_gr; metoda = d.method; } else saldo -= d.amount_gr;
  }
  return { saldoGr: saldo, metoda };
}

/**
 * @param {object} w pola: end_on, last_period, zwrot_gr, zwrot_metoda, zatrzymanie_gr, zatrzymanie_powod, deposit_on
 * @param {object} k kontekst
 * @param {object} k.najem wiersz rentals
 * @param {object} k.umowa wiersz contracts
 * @param {Array} k.stawki, k.korekty – tego najmu
 * @param {Array} k.najmyJednostki – wszystkie najmy jednostki (kolizja przy przesunięciu końca)
 * @param {{saldoGr:number, metoda:string}|null} k.kaucja – null, gdy kaucji się tu nie rozlicza
 * @param {object} k.ustawienia, k.dzis
 * @returns {{ bledy, ostatniaNaleznosc, pakiet? }}
 */
export function walidujKoniec(w, { najem, umowa, stawki = [], korekty = [], najmyJednostki = [], kaucja = null,
  ustawienia, dzis, noweId = losoweId }) {
  const bledy = {};
  const koniec = data(w, 'end_on', bledy, { wymagana: true, etykieta: 'datę końca' });
  if (koniec && koniec < najem.start_on) bledy.end_on = `Data końca nie może być wcześniejsza niż start (${formatData(najem.start_on)}).`;
  if (koniec && !bledy.end_on) {
    const nastepny = najmyJednostki.find((n) => n.id !== najem.id && n.start_on > najem.start_on && n.start_on <= koniec);
    if (nastepny) bledy.end_on = `Od ${formatData(nastepny.start_on)} jednostka ma kolejny najem. Koniec musi być wcześniej.`;
  }
  const ostatni = w.last_period === 'pelny' ? 'pelny' : 'proporcjonalnie';

  let zwrot = null;
  let zatrzymanie = null;
  let dataKaucji = null;
  if (kaucja && kaucja.saldoGr > 0) {
    zwrot = kwota(w, 'zwrot_gr', bledy, { dodatnia: true });
    zatrzymanie = kwota(w, 'zatrzymanie_gr', bledy, { dodatnia: true });
    if (!bledy.zwrot_gr && !bledy.zatrzymanie_gr && (zwrot ?? 0) + (zatrzymanie ?? 0) > kaucja.saldoGr) {
      bledy.zwrot_gr = `Zwrot i zatrzymanie razem nie mogą przekroczyć kaucji (${formatZl(kaucja.saldoGr)}).`;
    }
    if (zatrzymanie && !POWODY_ZATRZYMANIA[w.zatrzymanie_powod]) bledy.zatrzymanie_powod = 'Wybierz powód zatrzymania.';
    dataKaucji = data(w, 'deposit_on', bledy) ?? koniec;
  }

  let ostatniaNaleznosc = null;
  if (koniec && !bledy.end_on) {
    const naleznosci = naleznosciNajmu({ ...najem, end_on: koniec, last_period: ostatni },
      { stawki, korekty, dataStart: ustawienia.data_start, dzis });
    ostatniaNaleznosc = naleznosci.at(-1) ?? null;
  }
  if (!bezBledow(bledy)) return { bledy, ostatniaNaleznosc };

  const pakiet = { rentals_end: [{ id: najem.id, end_on: koniec, last_period: ostatni }], payments: [], deposits: [] };
  if (zwrot) {
    pakiet.deposits.push({ contract_id: umowa.id, kind: 'zwrot', amount_gr: zwrot,
      method: w.zwrot_metoda === 'przelew' ? 'przelew' : 'gotowka', on_date: dataKaucji });
  }
  if (zatrzymanie) {
    const wplataId = noweId();
    const naCzynsz = w.zatrzymanie_powod === 'czynsz';
    pakiet.payments.push({
      id: wplataId, booked_on: dataKaucji, amount_gr: zatrzymanie,
      kind: naCzynsz ? 'czynsz' : 'przychod_inny', method: 'kaucja',
      client_id: umowa.client_id, contract_id: umowa.id, match_method: 'reczne', match_confirmed: true,
      note: `Zatrzymanie kaucji: ${POWODY_ZATRZYMANIA[w.zatrzymanie_powod].toLowerCase()}`,
    });
    pakiet.deposits.push({
      contract_id: umowa.id, kind: 'zatrzymanie', amount_gr: zatrzymanie, method: kaucja.metoda,
      on_date: dataKaucji, reason: POWODY_ZATRZYMANIA[w.zatrzymanie_powod].toLowerCase(), payment_id: wplataId,
    });
  }
  return { bledy, ostatniaNaleznosc, pakiet };
}

// ---------------------------------------------------------------------
// Korekta należności (8.6)
// ---------------------------------------------------------------------

/**
 * @param {object} w pola: period_start, amount_gr, reason
 * @param {{ najem: object, naleznosci: Array }} kontekst naleznosci – z naleznosciNajmu() tego najmu
 */
export function walidujKorekte(w, { najem, naleznosci }) {
  const bledy = {};
  const okres = naleznosci.find((n) => n.poczatek === w.period_start);
  if (!okres) bledy.period_start = 'Wybierz okres.';
  let kw;
  if (w.tryb === 'kwota') {
    // Ręczna kwota należności (np. niepełny pierwszy miesiąc liczony inaczej niż proporcjonalnie):
    // korekta = nowa kwota − obecna kwota okresu (z dotychczasowymi korektami).
    const nowa = kwota(w, 'nowa_kwota', bledy, { wymagana: true, nieujemna: true, etykieta: 'kwotę należności' });
    if (okres && nowa != null && !bledy.nowa_kwota) {
      kw = nowa - (okres.bazowaGr + okres.korektaGr);
      if (kw === 0) bledy.nowa_kwota = `Ten okres już ma kwotę ${formatZl(nowa)}.`;
    }
  } else {
    kw = kwota(w, 'amount_gr', bledy, { wymagana: true, etykieta: 'kwotę korekty (+ albo −)' });
    if (kw === 0) bledy.amount_gr = 'Korekta nie może wynosić 0 zł.';
  }
  const powod = tekst(w.reason) || (w.tryb === 'kwota' ? 'Ręczna kwota okresu' : '');
  if (!powod) bledy.reason = 'Podaj powód korekty.';
  else if (powod.length > 200) bledy.reason = 'Najwyżej 200 znaków.';

  if (okres && kw && !bledy.amount_gr) {
    const poKorekcie = okres.bazowaGr + okres.korektaGr + kw;
    if (poKorekcie < 0) {
      bledy.amount_gr = `Po korekcie należność byłaby ujemna (${formatZl(poKorekcie)}). Najniższa możliwa korekta to ${formatZl(-(okres.bazowaGr + okres.korektaGr))}.`;
    }
  }
  if (!bezBledow(bledy)) return { bledy };
  return { bledy, wiersz: { rental_id: najem.id, period_start: okres.poczatek, amount_gr: kw, reason: powod } };
}

// ---------------------------------------------------------------------
// Ustawienia (8.8) i konto bankowe
// ---------------------------------------------------------------------

export function walidujUstawienia(w, { dzis }) {
  const bledy = {};
  const wiersz = {
    tolerance_days: calkowitaWZakresie(w, 'tolerance_days', bledy, 0, 60, 'Tolerancja: od 0 do 60 dni.'),
    punctuality_months: calkowitaWZakresie(w, 'punctuality_months', bledy, 1, 36, 'Okno: od 1 do 36 miesięcy.'),
    expiring_days: calkowitaWZakresie(w, 'expiring_days', bledy, 0, 365, 'Od 0 do 365 dni.'),
    default_last_period: w.default_last_period === 'pelny' ? 'pelny' : 'proporcjonalnie',
    default_billing_day: calkowitaWZakresie(w, 'default_billing_day', bledy, 1, 31, 'Dzień płatności: od 1 do 31.'),
    tax_period: w.tax_period === 'miesiac' ? 'miesiac' : 'kwartal',
    tax_rate_low_bp: procentBp(w, 'tax_rate_low_bp', bledy),
    tax_rate_high_bp: procentBp(w, 'tax_rate_high_bp', bledy),
    tax_threshold_gr: kwota(w, 'tax_threshold_gr', bledy, { wymagana: true, nieujemna: true, etykieta: 'próg' }),
    vat_limit_gr: kwota(w, 'vat_limit_gr', bledy, { wymagana: true, nieujemna: true, etykieta: 'limit' }),
    tax_account: null,
    data_start: data(w, 'data_start', bledy, { wymagana: true, etykieta: 'datę startu danych' }),
  };
  if (tekst(w.tax_account)) {
    wiersz.tax_account = oczyscRachunek(w.tax_account);
    if (!wiersz.tax_account) bledy.tax_account = 'Numer rachunku musi mieć 26 cyfr.';
  }
  if (wiersz.data_start && wiersz.data_start > dzis) bledy.data_start = 'Data startu nie może być w przyszłości.';
  return { bledy, wiersz };
}

/**
 * Kaucja dopisana później (karta klienta → Dodaj kaucję): przyjęcie kaucji do umowy.
 * umowy – umowy klienta, do których można dopisać kaucję (z najmem innym niż box).
 */
export function walidujKaucje(w, { umowy = [], dzis }) {
  const bledy = {};
  const umowa = umowy.find((u) => u.id === w.contract_id);
  if (!umowa) bledy.contract_id = 'Wybierz umowę.';
  const kwotaGr = kwota(w, 'amount_gr', bledy, { wymagana: true, dodatnia: true, etykieta: 'kwotę kaucji' });
  const dzien = data(w, 'on_date', bledy, { wymagana: true, etykieta: 'datę przyjęcia' });
  if (dzien && dzien > dzis) bledy.on_date = 'Data nie może być w przyszłości.';
  return {
    bledy,
    wiersz: bezBledow(bledy) ? {
      contract_id: umowa.id, kind: 'przyjecie', amount_gr: kwotaGr,
      method: w.method === 'przelew' ? 'przelew' : 'gotowka', on_date: dzien,
    } : null,
  };
}

export function walidujKonto(w, { konta = [], id = null } = {}) {
  const bledy = {};
  const name = tekst(w.name);
  if (!name) bledy.name = 'Podaj nazwę konta, np. „Nest – najem”.';
  else if (name.length > 60) bledy.name = 'Najwyżej 60 znaków.';
  if (!BANKI[w.bank]) bledy.bank = 'Wybierz bank.';
  let iban = null;
  if (tekst(w.iban)) {
    iban = oczyscRachunek(w.iban);
    if (!iban) bledy.iban = 'Numer rachunku musi mieć 26 cyfr.';
    else if (konta.some((k) => k.id !== id && k.iban === iban)) bledy.iban = 'To konto jest już dodane.';
  }
  return { bledy, wiersz: { name, bank: w.bank, iban, archived: zaznaczone(w.archived) } };
}

// ---------------------------------------------------------------------
// Wpłata gotówką (krok 1b)
// ---------------------------------------------------------------------

export const RODZAJE_GOTOWKI = Object.freeze({ czynsz: 'Czynsz', przychod_inny: 'Inny przychód' });

/**
 * Gdzie klient płaci za najem (decyzja 4): przelew na konto (puste = nieustalone), gotówka albo FV.
 * Gotówka i FV nie mają konta (ograniczenie rentals_gotowka_bez_konta dotyczy gotówki).
 * @param {object} w pola: pay_method, bank_account_id
 * @param {{ konta?: Map }} kontekst
 */
export function walidujMiejscePlatnosci(w, { konta = new Map(), wymagajKonta = false } = {}) {
  const bledy = {};
  const pay_method = w.pay_method in MIEJSCA_PLATNOSCI ? w.pay_method : 'przelew';
  let bank_account_id = pay_method === 'przelew' ? lubNull(w.bank_account_id) : null;
  // Nowy najem (prośba 11.11): przy przelewie konto musi być wskazane, żeby klient wiedział, gdzie płacić.
  if (wymagajKonta && pay_method === 'przelew' && !bank_account_id && konta.size) {
    bledy.bank_account_id = 'Wybierz konto, na które klient będzie wpłacał.';
  }
  if (bank_account_id && !konta.has(bank_account_id)) {
    bledy.bank_account_id = 'Nie ma takiego konta.';
    bank_account_id = null;
  }
  return { bledy, wiersz: { pay_method, bank_account_id } };
}

/**
 * Wypowiedzenie najmu (prośba 11.11): wybrane trwające najmy klienta, data złożenia i data końca najmu.
 * @param {object} w pola: given_on, end_on, najem_<id> = 'on'
 * @param {{ najmy: Array, dzis: string }} kontekst najmy – trwające najmy klienta
 * @returns {{ bledy, wybrane: Array, zmiany: { notice_given_on, notice_end_on } }}
 */
export function walidujWypowiedzenie(w, { najmy }) {
  const bledy = {};
  const given_on = data(w, 'given_on', bledy, { wymagana: true, etykieta: 'datę złożenia' });
  const end_on = data(w, 'end_on', bledy, { wymagana: true, etykieta: 'datę końca najmu' });
  if (given_on && end_on && end_on < given_on) bledy.end_on = 'Koniec najmu nie może być przed złożeniem wypowiedzenia.';
  const wybrane = najmy.filter((n) => w[`najem_${n.id}`] === 'on');
  if (!wybrane.length) bledy.najmy = 'Zaznacz co najmniej jedną jednostkę.';
  for (const n of wybrane) if (end_on && end_on < n.start_on) bledy.end_on = 'Koniec najmu przed jego startem.';
  return { bledy, wybrane, zmiany: { notice_given_on: given_on, notice_end_on: end_on } };
}

/**
 * Wpłata ryczałtu za kwartał (6.5, tabela tax_payments).
 * @param {object} w pola: paid_on, amount_gr
 * @param {{ rok: number, q: number, grupa: string, dzis: string }} kontekst (grupa – licznik ryczałtu)
 */
export function walidujWplateRyczaltu(w, { rok, q, grupa = 'pozostale', dzis }) {
  const bledy = {};
  const paid_on = data(w, 'paid_on', bledy, { wymagana: true, etykieta: 'datę wpłaty' });
  if (paid_on && paid_on > dzis) bledy.paid_on = 'Data wpłaty nie może być w przyszłości.';
  const amount_gr = kwota(w, 'amount_gr', bledy, { wymagana: true, nieujemna: true });
  return { bledy, wiersz: { year: rok, quarter: q, grupa, paid_on, amount_gr } };
}

/**
 * @param {object} w pola: booked_on, client_id, amount_gr, kind, note
 * @param {{ klienci?: Map, dataStart?: string, dzis: string }} kontekst
 */
export function walidujGotowke(w, { klienci = new Map(), konta = new Map(), najmyKlienta = new Map(), dataStart = null, dzis }) {
  const bledy = {};
  const booked_on = data(w, 'booked_on', bledy, { wymagana: true, etykieta: 'datę wpłaty' });
  if (booked_on && booked_on > dzis) bledy.booked_on = 'Data wpłaty nie może być w przyszłości.';
  else if (booked_on && dataStart && booked_on < dataStart) {
    bledy.booked_on = `Data przed startem danych (${formatData(dataStart)}) – takie wpłaty są w saldzie otwarcia.`;
  }
  const client_id = tekst(w.client_id);
  if (!client_id) bledy.client_id = 'Wybierz klienta.';
  else if (!klienci.has(client_id)) bledy.client_id = 'Nie ma takiego klienta.';
  const amount_gr = kwota(w, 'amount_gr', bledy, { wymagana: true, dodatnia: true });
  const kind = w.kind in RODZAJE_GOTOWKI ? w.kind : 'czynsz';
  const note = lubNull(w.note);
  if (note && note.length > 500) bledy.note = 'Najwyżej 500 znaków.';
  // Przelew wpisany ręcznie (np. po 20., zanim pobierze się wyciąg): konto wymagane – od niego zależą limity VAT.
  const method = w.method === 'przelew' ? 'przelew' : 'gotowka';
  let bank_account_id = null;
  let title = null;
  if (method === 'przelew') {
    bank_account_id = tekst(w.bank_account_id) || null;
    if (!bank_account_id) bledy.bank_account_id = 'Wybierz konto, na które wpłynął przelew.';
    else if (!konta.has(bank_account_id)) bledy.bank_account_id = 'Nie ma takiego konta.';
    title = lubNull(w.title);
    if (title && title.length > 140) bledy.title = 'Najwyżej 140 znaków.';
  }
  // Za jednostkę (opcjonalnie): najem tego klienta; puste = automatycznie od najstarszej należności.
  let rental_id = tekst(w.rental_id) || null;
  if (rental_id && !(najmyKlienta.get(client_id) ?? []).some((n) => n.id === rental_id)) {
    bledy.rental_id = 'Ta jednostka nie należy do wybranego klienta.';
    rental_id = null;
  }
  if (kind !== 'czynsz') rental_id = null;
  return {
    bledy,
    wiersz: {
      booked_on, client_id: client_id || null, amount_gr, kind, note, title, rental_id,
      method, bank_account_id, match_method: 'reczne', match_confirmed: true,
    },
  };
}
