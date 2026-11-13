// Kreatory (0.24.0): prowadzone ścieżki „Nowy klient”, „Zakończenie najmu” i „Miesięczny przegląd”.
// Każdy krok ma stan liczony z danych (zrobione / do zrobienia / pominięte / później / czeka) – kreator nie zapisuje
// własnych danych w bazie. Kroki, których nie da się odczytać z danych (np. pobrana umowa, sprawdzone koszty),
// odhacza się ręcznie; ten znacznik zostaje na urządzeniu (localStorage). Czyste funkcje (tests/kreator.test.js).

import { bezKaucji } from './config.js';
import { bramaJednostki, stanBramKlienta } from './bramy.js';
import { doPrzypisania, najemTrwa } from './dane.js';
import { saldoKaucji } from './walidacja.js';
import { pilneZadania } from './zadania.js';
import { dodajDni, formatData } from './utils.js';

/** Stany kroku. „czeka” – poprzedni krok jeszcze niezrobiony; „pozniej” – na ten krok jeszcze za wcześnie. */
export const STANY = Object.freeze({
  zrobione: 'zrobione', doZrobienia: 'do-zrobienia', pominiete: 'pominiete', pozniej: 'pozniej', czeka: 'czeka',
});

const zrobione = (krok) => krok.stan === STANY.zrobione || krok.stan === STANY.pominiete;

/** Postęp: { gotowe, razem, udzial, nastepny } – nastepny = pierwszy krok do zrobienia. */
export function postep(kroki) {
  const razem = kroki.length;
  const gotowe = kroki.filter(zrobione).length;
  return { gotowe, razem, udzial: razem ? gotowe / razem : 1, nastepny: kroki.find((k) => k.stan === STANY.doZrobienia) ?? null };
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------
// Nowy klient: Klient → Najem → Umowa → Brama → Kaucja
// ---------------------------------------------------------------------

/**
 * @param {{ dane, indeksy }} s
 * @param {{ klientId?: string, najemId?: string, reczne?: Set<string>, mamWzory?: boolean }} p
 */
export function krokiNowegoKlienta(s, { klientId = null, najemId = null, reczne = new Set(), mamWzory = true }, dzis) {
  const klient = klientId ? s.indeksy.klienci.get(klientId) ?? null : null;
  const najem = najemId ? s.dane.rentals.find((n) => n.id === najemId) ?? null : null;
  const jednostka = najem ? s.indeksy.jednostki.get(najem.unit_id) : null;
  const umowa = najem ? s.indeksy.umowy.get(najem.contract_id) : null;
  const k = klient ? enc(klient.id) : '';
  const kroki = [];

  kroki.push({
    id: 'klient', nazwa: 'Dane klienta',
    stan: klient ? STANY.zrobione : STANY.doZrobienia,
    opis: klient ? klient.name : 'Imię i nazwisko albo firma, telefon, e-mail, adres, dokument.',
    href: klient ? `#/klienci/${k}/edycja` : '#/klienci/nowy', tekst: klient ? 'Popraw dane' : 'Wpisz dane klienta',
  });

  kroki.push({
    id: 'najem', nazwa: 'Najem',
    stan: !klient ? STANY.czeka : najem ? STANY.zrobione : STANY.doZrobienia,
    opis: najem ? `${jednostka?.code ?? '?'} od ${formatData(najem.start_on)}` : 'Jednostka, stawka, promocja, gdzie klient płaci.',
    href: klient ? `#/najmy/nowy?klient=${k}` : null, tekst: 'Dodaj najem',
  });

  kroki.push({
    id: 'umowa', nazwa: 'Umowa do podpisania',
    stan: !najem ? STANY.czeka : reczne.has('umowa') ? STANY.zrobione : STANY.doZrobienia,
    opis: !mamWzory ? 'Najpierw dodaj wzór umowy (Ustawienia → Wzory umów).'
      : reczne.has('umowa') ? 'Umowa pobrana.' : 'Pobierz umowę z wzoru, wydrukuj i podpisz.',
    href: najem ? (mamWzory ? `#/klienci/${k}/umowa?najem=${enc(najem.id)}` : '#/ustawienia') : null,
    tekst: mamWzory ? 'Przygotuj umowę' : 'Wzory umów', reczny: Boolean(najem),
  });

  // Brama: pomijana, gdy bram nie skonfigurowano.
  if (s.dane.gates?.length) {
    const numer = jednostka ? bramaJednostki(jednostka) : null;
    const b = najem ? stanBramKlienta(s, klient.id, dzis).find((x) => x.numer === numer) : null;
    kroki.push({
      id: 'brama', nazwa: numer ? `Brama ${numer}` : 'Brama',
      stan: !najem ? STANY.czeka : b?.dostep ? STANY.zrobione : STANY.doZrobienia,
      opis: b?.dostep ? `Numer ${b.dostep.phone} ma dostęp.` : 'Dopisz telefon klienta do sterownika bramy (SMS).',
      href: najem ? `#/bramy/${k}?brama=${numer}` : null, tekst: 'Przypisz do bramy',
    });
  }

  // Kaucja: boxy bez kaucji (decyzja 22).
  const kaucjaGr = umowa ? saldoKaucji(s.dane.deposits, umowa.id).saldoGr : 0;
  const box = jednostka && bezKaucji(jednostka.type);
  kroki.push({
    id: 'kaucja', nazwa: 'Kaucja',
    stan: !najem ? STANY.czeka : box || reczne.has('kaucja') ? STANY.pominiete : kaucjaGr > 0 ? STANY.zrobione : STANY.doZrobienia,
    opis: box ? 'Boxy wynajmujemy bez kaucji.' : kaucjaGr > 0 ? 'Kaucja przyjęta.'
      : reczne.has('kaucja') ? 'Pominięto – bez kaucji.' : 'Wpisz przyjętą kaucję (gotówka albo przelew).',
    href: najem && !box ? `#/klienci/${k}/kaucja` : null, tekst: 'Dodaj kaucję', pomin: Boolean(najem) && !box && kaucjaGr <= 0,
  });

  return kroki;
}

// ---------------------------------------------------------------------
// Zakończenie najmu: Wypowiedzenie → Odczyt prądu → Zakończ najem i rozlicz kaucję → Usuń z bramy
// ---------------------------------------------------------------------

/** Data końca najmu: zapisany koniec, a gdy go nie ma – koniec z wypowiedzenia. */
export const koniecNajmu = (najem) => najem?.end_on ?? najem?.notice_end_on ?? null;

export function krokiKonca(s, najemId, dzis, reczne = new Set()) {
  const najem = s.dane.rentals.find((n) => n.id === najemId);
  if (!najem) return [];
  const umowa = s.indeksy.umowy.get(najem.contract_id);
  const klient = umowa ? s.indeksy.klienci.get(umowa.client_id) : null;
  const jednostka = s.indeksy.jednostki.get(najem.unit_id);
  const k = klient ? enc(klient.id) : '';
  const koniec = koniecNajmu(najem);
  const zakonczony = najem.end_on != null;
  const kroki = [];

  kroki.push({
    id: 'wypowiedzenie', nazwa: 'Wypowiedzenie',
    stan: najem.notice_given_on || zakonczony ? STANY.zrobione : STANY.doZrobienia,
    opis: najem.notice_given_on ? `Złożone ${formatData(najem.notice_given_on)}, koniec najmu ${formatData(najem.notice_end_on)}.`
      : zakonczony ? `Data końca najmu: ${formatData(najem.end_on)}.` : 'Data złożenia i koniec najmu – powstanie zadanie z terminem.',
    href: klient ? `#/klienci/${k}/wypowiedzenie` : null, tekst: 'Zapisz wypowiedzenie',
  });

  if (jednostka?.has_power) {
    const odczyt = (s.dane.power_readings ?? []).some((o) => o.rental_id === najem.id && koniec && o.read_on >= dodajDni(koniec, -31));
    kroki.push({
      id: 'prad', nazwa: 'Odczyt licznika prądu',
      stan: odczyt || reczne.has('prad') ? STANY.zrobione : !koniec ? STANY.czeka : STANY.doZrobienia,
      opis: odczyt ? 'Odczyt końcowy zapisany.' : reczne.has('prad') ? 'Odhaczone ręcznie.'
        : 'Spisz stan licznika przy wydaniu jednostki i wpisz go w rozliczeniu prądu – kwota doliczy się do należności.',
      href: '#/prad', tekst: 'Rozliczenie prądu', reczny: Boolean(koniec) && !odczyt,
    });
  }

  kroki.push({
    id: 'koniec', nazwa: 'Zakończ najem',
    stan: zakonczony ? STANY.zrobione : !koniec ? STANY.czeka : koniec > dzis ? STANY.pozniej : STANY.doZrobienia,
    opis: zakonczony ? `Zakończony ${formatData(najem.end_on)}.` : koniec && koniec > dzis
      ? `Zrób to w dniu końca najmu (${formatData(koniec)}) albo później.` : 'Ostatnia należność i rozliczenie kaucji w jednym formularzu.',
    href: `#/najmy/${enc(najem.id)}/koniec`, tekst: 'Zakończ najem',
  });

  const box = jednostka && bezKaucji(jednostka.type);
  const kaucjaGr = umowa ? saldoKaucji(s.dane.deposits, umowa.id).saldoGr : 0;
  const inneTrwajace = umowa && s.dane.rentals.some((n) => n.contract_id === umowa.id && n.id !== najem.id && n.end_on == null);
  kroki.push({
    id: 'kaucja', nazwa: 'Kaucja',
    stan: box || kaucjaGr <= 0 ? (kaucjaGr <= 0 && !box ? STANY.zrobione : STANY.pominiete)
      : inneTrwajace ? STANY.pominiete : zakonczony ? STANY.doZrobienia : STANY.czeka,
    opis: box ? 'Boxy bez kaucji.' : kaucjaGr <= 0 ? 'Brak kaucji do rozliczenia.'
      : inneTrwajace ? 'Kaucja zostaje przy umowie – inne najmy w tej umowie trwają.'
        : `Do rozliczenia: ${(kaucjaGr / 100).toFixed(2).replace('.', ',')} zł – zwrot albo zatrzymanie w formularzu „Zakończ najem”.`,
    href: zakonczony && klient ? `#/klienci/${k}` : null, tekst: 'Karta klienta',
  });

  if (s.dane.gates?.length && klient) {
    const numer = bramaJednostki(jednostka);
    const b = stanBramKlienta(s, klient.id, dzis).find((x) => x.numer === numer);
    let stan = STANY.zrobione;
    let opis = 'Klient nie ma dostępu do bramy.';
    if (b?.dostep && b.usunOd == null) { stan = STANY.pominiete; opis = 'Klient ma inny trwający najem za tą bramą – numer zostaje.'; }
    else if (b?.dostep && b.usunOd > dzis) { stan = STANY.pozniej; opis = `Numer usuń od ${formatData(b.usunOd)} (koniec najmu + 3 dni).`; }
    else if (b?.dostep) { stan = STANY.doZrobienia; opis = `Numer ${b.dostep.phone} – usuń ze sterownika (od ${formatData(b.usunOd)}).`; }
    else if (!koniec) stan = STANY.czeka;
    kroki.push({ id: 'brama', nazwa: `Usuń z bramy ${numer}`, stan, opis, href: `#/bramy/${k}?brama=${numer}`, tekst: 'Usuń z bramy' });
  }
  return kroki;
}

// ---------------------------------------------------------------------
// Miesięczny przegląd: Wyciągi → Przypisz wpłaty → Przypomnienia → Koszty → Zadania
// ---------------------------------------------------------------------

/** Miesiąc przeglądu: od 15. dnia – bieżący, wcześniej – poprzedni (wpłaty za poprzedni miesiąc jeszcze się domykają). */
export function miesiacPrzegladu(dzis) {
  const [y, m, d] = dzis.split('-').map(Number);
  if (d >= 15) return `${y}-${String(m).padStart(2, '0')}`;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * @param {{ dane }} s
 * @param {{ miesiac: string, dzis: string, reczne?: Set<string>, doPrzypomnienia: number, terminDzien?: number }} p
 *   doPrzypomnienia – liczba zalegających bez przypomnienia od terminu miesiąca (liczy widok przypomnień)
 */
export function krokiMiesiaca(s, { miesiac, dzis, reczne = new Set(), doPrzypomnienia = 0, terminDzien = 20 }) {
  const termin = `${miesiac}-${String(terminDzien).padStart(2, '0')}`;
  const przedTerminem = dzis < termin;
  const konta = s.dane.bank_accounts.filter((k) => !k.archived);
  const bezWyciagu = konta.filter((k) => !s.dane.imports.some((i) => i.bank_account_id === k.id && i.imported_at.slice(0, 10) >= termin));
  const nieprzypisane = doPrzypisania(s.dane.payments).length;
  const zadan = pilneZadania(s.dane.client_notes, dzis);
  const kosztyMiesiaca = (s.dane.expenses ?? []).filter((e) => e.category !== 'pominiety' && e.spent_on?.startsWith(miesiac));

  return [
    {
      id: 'wyciagi', nazwa: 'Wczytaj wyciągi',
      stan: !konta.length || (!bezWyciagu.length) ? STANY.zrobione : przedTerminem ? STANY.pozniej : STANY.doZrobienia,
      opis: !konta.length ? 'Brak kont bankowych.' : bezWyciagu.length
        ? `Bez wyciągu po ${termin.slice(8)}.${termin.slice(5, 7)}: ${bezWyciagu.map((k) => k.name).join(', ')}.`
        : 'Wyciągi ze wszystkich kont wczytane po terminie płatności.',
      href: '#/import', tekst: 'Import wyciągu',
    },
    {
      id: 'przypisz', nazwa: 'Przypisz wpłaty',
      stan: nieprzypisane ? STANY.doZrobienia : STANY.zrobione,
      opis: nieprzypisane ? `${nieprzypisane} wpłat bez klienta.` : 'Wszystkie wpłaty przypisane.',
      idz: { ekran: 'wplaty', filtr: 'do-przypisania' }, tekst: 'Przypisz',
    },
    {
      id: 'przypomnienia', nazwa: 'Przypomnij zalegającym',
      stan: przedTerminem ? STANY.pozniej : doPrzypomnienia ? STANY.doZrobienia : STANY.zrobione,
      opis: przedTerminem ? `Po terminie płatności (${termin.slice(8)}.${termin.slice(5, 7)}).`
        : doPrzypomnienia ? `${doPrzypomnienia} klientów zalega i nie dostało przypomnienia po terminie.` : 'Wszyscy zalegający dostali przypomnienie.',
      href: '#/przypomnienia', tekst: 'Przypomnienia',
    },
    {
      id: 'koszty', nazwa: 'Sprawdź koszty',
      stan: reczne.has('koszty') ? STANY.zrobione : STANY.doZrobienia,
      opis: `${kosztyMiesiaca.length} kosztów w miesiącu – sprawdź kategorie i dopisz koszty spoza wyciągu (gotówka).`,
      href: '#/koszty', tekst: 'Koszty', reczny: true,
    },
    {
      id: 'zadania', nazwa: 'Zadania na dziś i po terminie',
      stan: zadan ? STANY.doZrobienia : STANY.zrobione,
      opis: zadan ? `${zadan} zadań czeka.` : 'Brak zaległych zadań.',
      idz: { ekran: 'zadania', filtr: 'do-zrobienia' }, tekst: 'Zadania',
    },
  ];
}

// ---------------------------------------------------------------------
// Pomocnicze: kreator dla najmów, które się kończą (Pulpit, karta klienta)
// ---------------------------------------------------------------------

/** Trwający albo niedawno zakończony najem z wypowiedzeniem / datą końca – czy kreator końca ma jeszcze coś do zrobienia. */
export function koniecDoZrobienia(s, najem, dzis) {
  if (!najem || (!najem.notice_end_on && !najem.end_on)) return false;
  if (najem.end_on && !najemTrwa(najem, dzis) && najem.end_on < dodajDni(dzis, -60)) return false;
  return postep(krokiKonca(s, najem.id, dzis)).nastepny != null;
}

// ---------------------------------------------------------------------
// Ręczne znaczniki kroków (localStorage) i bieżący kreator (sessionStorage)
// ---------------------------------------------------------------------

const KLUCZ = 'najem.kreator.reczne';

function czytaj(magazyn, klucz, domyslnie) {
  try { return JSON.parse(globalThis[magazyn]?.getItem(klucz) ?? 'null') ?? domyslnie; } catch { return domyslnie; }
}
function pisz(magazyn, klucz, wartosc) {
  try {
    if (wartosc == null) globalThis[magazyn]?.removeItem(klucz);
    else globalThis[magazyn]?.setItem(klucz, JSON.stringify(wartosc));
  } catch { /* tryb prywatny – znacznik tylko do odświeżenia */ }
}

/** Ręcznie odhaczone kroki dla klucza (np. „klient:<id najmu>”, „koniec:<id najmu>”, „miesiac:2026-11”). */
export const reczneKroki = (klucz) => new Set(czytaj('localStorage', KLUCZ, {})[klucz] ?? []);

export function oznaczKrok(klucz, krok, zrobiony = true) {
  const wszystkie = czytaj('localStorage', KLUCZ, {});
  const zbior = new Set(wszystkie[klucz] ?? []);
  if (zrobiony) zbior.add(krok); else zbior.delete(krok);
  wszystkie[klucz] = [...zbior];
  pisz('localStorage', KLUCZ, wszystkie);
}

const KLUCZ_BIEZACEGO = 'najem.kreator.biezacy';
/** Bieżący kreator { typ, href, nazwa, najemId? } – pasek „Wróć do kreatora” na innych ekranach. */
export const biezacyKreator = () => czytaj('sessionStorage', KLUCZ_BIEZACEGO, null);
export const ustawKreator = (k) => pisz('sessionStorage', KLUCZ_BIEZACEGO, k);

/**
 * Formularz otwarty z kreatora zapisał dane i chce przejść na `sciezka` – dokąd wrócić.
 * Kreator „klient” przejmuje z adresu id klienta i nowego najmu; pozostałe wracają pod swój adres. null – bez zmiany.
 */
export function powrotDoKreatora(kreator, sciezka) {
  if (!kreator || kreator.typ === 'miesiac') return null;
  if (kreator.typ !== 'klient') return kreator.href.replace(/^#\//, '');
  const [droga, zapytanie = ''] = sciezka.split('?');
  const q = new URLSearchParams(zapytanie);
  const stare = new URLSearchParams(kreator.href.split('?')[1] ?? '');
  const zKlienci = /^klienci\/([^/]+)/.exec(droga)?.[1];
  const klient = q.get('klient') ?? (zKlienci && zKlienci !== 'nowy' ? decodeURIComponent(zKlienci) : null) ?? stare.get('klient');
  const najem = q.get('nowy') ?? stare.get('najem');
  const wynik = new URLSearchParams();
  if (klient) wynik.set('klient', klient);
  if (najem) wynik.set('najem', najem);
  const tekst = wynik.toString();
  return `kreator/klient${tekst ? `?${tekst}` : ''}`;
}
