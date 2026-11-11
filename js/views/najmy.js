// Formularze najmu (8.6) – ekran bez własnej zakładki:
//   #/najmy/nowy[?klient=<id>&jednostka=<id>]   nowy najem (umowa, stawka, kaucja, PDF)
//   #/najmy/<id>/stawka                          zmiana stawki jednego najmu
//   #/najmy/<id>/koniec                          zakończenie najmu z rozliczeniem kaucji
//   #/najmy/<id>/korekta                         korekta należności (rabat, umorzenie, dopłata)
//   #/najmy/podwyzka                             zmiana stawek wielu najmów naraz
//   #/najmy/<id>/promocja                        promocja: rabat % na N pierwszych okresów (lista: js/promocje.js)
//   #/najmy/<id>/platnosc                        gdzie płaci: przelew na konto, gotówka albo FV (decyzja 4)

import { TYPY_JEDNOSTEK, bezKaucji } from '../config.js';
import { biezacyNajem, MIEJSCA_PLATNOSCI, najemTrwa, opisPlatnosci, planowanyKoniec, stawkaNaDzien } from '../dane.js';
import {
  formularz, kwotaPodgladu, maBledy, opcje, plik, pole, przelacznik, sekcja, stanFormularza, wartosciFormularza,
  wybor, zapisz,
} from '../formularz.js';
import { naleznosciNajmu } from '../okresy.js';
import {
  czytajWarunki, listaPromocji, nowaPozycja, opisWarunkow, planPromocji, wierszeStawek,
} from '../promocje.js';
import { pustyStan } from '../ui.js';
import {
  esc, dodajDni, dodajMiesiace, dzisiaj, formatRachunek, formatData, formatZl, iso, kwotaDoPola, parseKwota, porownajKody,
} from '../utils.js';
import {
  BANKI, OKRESY_ROZLICZENIOWE, POWODY_ZATRZYMANIA, TRYBY_STAWKI, saldoKaucji, walidujKoniec, walidujKorekte,
  walidujMiejscePlatnosci, walidujNajem, walidujPdf, walidujPodwyzke, walidujZmianeStawki, zaznaczone,
} from '../walidacja.js';
import { ustawienia } from './wspolne.js';

const NAZWY_OKRESOW = { 1: 'Miesiąc', 3: 'Kwartał (3 miesiące)', 6: 'Pół roku', 12: 'Rok' };
const OSTATNI_OKRES = [
  { wartosc: 'proporcjonalnie', tekst: 'Proporcjonalnie do dni' },
  { wartosc: 'pelny', tekst: 'Pełny okres' },
];
const FORMY = [{ wartosc: 'gotowka', tekst: 'Gotówka' }, { wartosc: 'przelew', tekst: 'Przelew' }];

/** Pierwszy dzień następnego miesiąca – typowa data podwyżki. */
const pierwszyNastepnegoMiesiaca = (dzien) => {
  const [y, m] = dodajMiesiace(dzien, 1).split('-').map(Number);
  return iso(y, m, 1);
};

/** Najem z adresu z jednostką, umową i klientem. */
function kontekstNajmu(s, id) {
  const najem = s.dane.rentals.find((n) => n.id === id);
  if (!najem) return null;
  const umowa = s.indeksy.umowy.get(najem.contract_id);
  return {
    najem, umowa,
    jednostka: s.indeksy.jednostki.get(najem.unit_id),
    klient: umowa && s.indeksy.klienci.get(umowa.client_id),
    stawki: [...(s.indeksy.stawkiNajmu.get(najem.id) ?? [])].sort((a, b) => a.valid_from.localeCompare(b.valid_from)),
    korekty: s.dane.charge_adjustments.filter((k) => k.rental_id === najem.id),
  };
}

/** Nagłówek formularza najmu: jednostka, klient, okres i bieżąca stawka. */
function naglowekNajmu(s, k) {
  const dzien = dzisiaj();
  const stawka = stawkaNaDzien(k.stawki, najemTrwa(k.najem, dzien) ? dzien : k.najem.end_on ?? k.najem.start_on);
  return `<section class="karta naglowek-najmu"><dl class="opis-pol">
    <dt>Jednostka</dt><dd class="mono">${esc(k.jednostka?.code ?? '?')}</dd>
    <dt>Klient</dt><dd>${esc(k.klient?.name ?? '—')}</dd>
    <dt>Najem</dt><dd>${formatData(k.najem.start_on)} – ${k.najem.end_on ? formatData(k.najem.end_on) : 'trwa'}</dd>
    <dt>Stawka</dt><dd class="kwota">${stawka != null ? formatZl(stawka) : '—'}</dd>
    <dt>Płaci</dt><dd>${esc(opisPlatnosci(k.najem, s.indeksy.konta))}</dd>
  </dl></section>`;
}

/** Pola „Gdzie płaci” (decyzja 4): sposób i – przy przelewie – konto. Wspólne dla nowego najmu i zmiany. */
/** Numer rachunku wybranego konta – do podania klientowi. */
function numerKonta(s, id) {
  const k = id && s.indeksy.konta.get(id);
  return k?.iban ? `<p class="podpowiedz">Numer do przelewu: <strong class="mono">${esc(formatRachunek(k.iban))}</strong></p>` : '';
}

function polaPlatnosci(f, s, { wymagajKonta = false } = {}) {
  const konta = s.dane.bank_accounts.filter((k) => !k.archived || k.id === f.wartosci.bank_account_id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    .map((k) => ({ wartosc: k.id, tekst: `${k.name} (${BANKI[k.bank] ?? k.bank})` }));
  return `${opcje(f, { nazwa: 'pay_method', legenda: 'Gdzie płaci', odswiez: true,
    opcje: Object.entries(MIEJSCA_PLATNOSCI).map(([wartosc, tekst]) => ({ wartosc, tekst })) })}
    ${(f.wartosci.pay_method ?? 'przelew') === 'przelew' ? (konta.length
    ? wybor(f, { nazwa: 'bank_account_id', etykieta: 'Na które konto klient będzie wpłacał', opcje: konta,
      pusta: wymagajKonta ? 'Wybierz konto…' : '— jeszcze nie wiem —', wymagane: wymagajKonta, odswiez: true })
      + numerKonta(s, f.wartosci.bank_account_id)
    : '<p class="podpowiedz">Brak kont bankowych – dodasz je w Ustawieniach.</p>') : ''}`;
}

function formularzPlatnosci(s, k) {
  const f = stanFormularza(s, `najmy/${k.najem.id}/platnosc`, () => ({
    pay_method: k.najem.pay_method ?? 'przelew', bank_account_id: k.najem.bank_account_id ?? '',
  }));
  return `${naglowekNajmu(s, k)}${formularz(f, {
    nazwa: 'platnosc',
    uwaga: '',
    przycisk: 'Zapisz',
    anuluj: k.klient ? `#/klienci/${encodeURIComponent(k.klient.id)}` : '#/klienci',
    tresc: polaPlatnosci(f, s),
  })}`;
}

async function zapiszPlatnosc(form, ctx) {
  const s = ctx.state;
  const k = kontekstNajmu(s, s.ui.parametr);
  if (!k) return;
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujMiejscePlatnosci(w, { konta: s.indeksy.konta });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const najem = await ctx.db.zmien('rentals', k.najem.id, wiersz);
    ctx.scal({ rentals: [najem] });
    ctx.toast(`${k.jednostka?.code ?? 'Najem'}: ${opisPlatnosci(najem, s.indeksy.konta)}`);
    ctx.nawiguj(k.klient ? `klienci/${encodeURIComponent(k.klient.id)}` : 'klienci');
  });
}

// ---------------------------------------------------------------------
// Nowy najem
// ---------------------------------------------------------------------

/** Najmy jednostki, które kolidują z nowym najmem bez końca od dnia `start` (trwają wtedy albo zaczynają się później). */
const kolizjeJednostki = (s, unitId, start) => (s.indeksy.najmyJednostki.get(unitId) ?? [])
  .filter((n) => n.end_on == null || n.end_on >= start);

const klientNajmu = (s, n) => s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);

/**
 * Jednostki do nowego najmu (prośba 11.11): wolne i na wypowiedzeniu (wolne od dnia po końcu najmu).
 * Zajęte bez wypowiedzenia – tylko po zaznaczeniu „Pokaż też zajęte” (przejęcie z zadaniem wypowiedzenia).
 */
function opcjeJednostek(s, dzien, { pokazZajete = false, wybrana = '' } = {}) {
  const kolejnosc = (a, b) => Object.keys(TYPY_JEDNOSTEK).indexOf(a.type) - Object.keys(TYPY_JEDNOSTEK).indexOf(b.type)
    || porownajKody(a.code, b.code);
  const wynik = [];
  for (const j of s.dane.units.filter((x) => !x.archived && !x.out_of_service).sort(kolejnosc)) {
    const kolizje = kolizjeJednostki(s, j.id, dzien);
    const typ = TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type;
    if (!kolizje.length) {
      wynik.push({ wartosc: j.id, tekst: `${j.code} · ${typ}`, grupa: 'Wolne', kol: 0 });
      continue;
    }
    const koniec = kolizje.length === 1 ? planowanyKoniec(kolizje[0], dzien) : null;
    const kto = klientNajmu(s, kolizje[0])?.name ?? '?';
    if (koniec) {
      wynik.push({ wartosc: j.id, tekst: `${j.code} · ${typ} – wolna od ${formatData(dodajDni(koniec, 1))} (${kto})`,
        grupa: 'Na wypowiedzeniu', kol: 1 });
    } else if (pokazZajete || j.id === wybrana) {
      wynik.push({ wartosc: j.id, tekst: `${j.code} · ${typ} – zajęta (${kto})`, grupa: 'Zajęte – wymaga wypowiedzenia', kol: 2 });
    }
  }
  return wynik.sort((a, b) => a.kol - b.kol);
}

/**
 * Najem obecnego najemcy przy wybranej jednostce i dacie startu: { najem, klient, koniec, wypowiedziany }
 * albo null (jednostka wolna) albo { blad } (np. kilka najmów w tym czasie, start przed obecnym najmem).
 */
function przejecieJednostki(s, unitId, start) {
  if (!unitId || !/^\d{4}-\d{2}-\d{2}$/.test(start ?? '')) return null;
  const kolizje = kolizjeJednostki(s, unitId, start);
  if (!kolizje.length) return null;
  if (kolizje.length > 1) return { blad: 'Ta jednostka ma już kilka najmów od tej daty (także zaplanowany). Wybierz inną datę albo jednostkę.' };
  const najem = kolizje[0];
  const klient = klientNajmu(s, najem);
  if (najem.start_on >= start) {
    return { blad: `Jednostka ma już najem od ${formatData(najem.start_on)} (${klient?.name ?? '?'}). Wybierz inną jednostkę.` };
  }
  const koniec = planowanyKoniec(najem, dzisiaj()) ?? najem.end_on;
  if (koniec && koniec >= start) {
    return { blad: `${klient?.name ?? 'Obecny najemca'} wynajmuje do ${formatData(koniec)}. Nowy najem może zacząć się najwcześniej ${
      formatData(dodajDni(koniec, 1))}.` };
  }
  return { najem, klient, koniec, wypowiedziany: Boolean(koniec) };
}

/** Informacja pod wyborem jednostki: kto ją teraz wynajmuje i co stanie się przy zapisie. */
function infoPrzejecia(f, s) {
  const p = przejecieJednostki(s, f.wartosci.unit_id, f.wartosci.start_on);
  if (!p) return '';
  if (p.blad) return `<p class="baner ostrzezenie">${esc(p.blad)}</p>`;
  const kto = esc(p.klient?.name ?? 'obecny najemca');
  if (p.wypowiedziany) {
    return `<p class="podpowiedz">Teraz wynajmuje ${kto} – wypowiedziana, koniec najmu ${formatData(p.koniec)}.
      Nowy najem zacznie się po nim, więc jednostka nie będzie wynajęta dwóm osobom naraz.</p>`;
  }
  const koniecStary = dodajDni(f.wartosci.start_on, -1);
  return `<div class="baner ostrzezenie"><p>Jednostkę wynajmuje teraz <strong>${kto}</strong> (umowa bez wypowiedzenia).
      Po zapisie najem ${kto} będzie trwał do <strong>${formatData(koniecStary)}</strong>, a w Zadaniach pojawi się
      zadanie „wypowiedz umowę” z terminem poniżej.</p></div>
    ${pole(f, { nazwa: 'wypowiedz_do', etykieta: `Wypowiedzieć umowę ${p.klient?.name ?? ''} do`, typ: 'date', wymagane: true, odswiez: true,
    podpowiedz: 'Termin zadania – najpóźniej wtedy trzeba złożyć wypowiedzenie obecnemu najemcy.' })}`;
}

/** Domyślny termin wypowiedzenia: miesiąc przed startem nowego najmu, nie wcześniej niż dziś. */
const domyslneWypowiedzDo = (start) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(start ?? '') ? dodajMiesiace(start, -1) : dzisiaj();
  return d < dzisiaj() ? dzisiaj() : d;
};

function wartosciNowegoNajmu(s) {
  const dzien = dzisiaj();
  const { klient = '', jednostka = '' } = s.ui.zapytanie;
  const cennik = s.indeksy.jednostki.get(jednostka)?.list_price_gr;
  return {
    client_id: klient, unit_id: jednostka, start_on: dzien, billing_day: String(ustawienia(s).default_billing_day ?? 20),
    amount_gr: kwotaDoPola(cennik), period_months: '1', last_period: ustawienia(s).default_last_period,
    deposit_method: 'gotowka', pay_method: 'przelew', bank_account_id: '',
    promo: '', promo_rabat: '50', promo_okresy: '2', promo_zapisz: '',
  };
}

function formularzNowegoNajmu(s) {
  const f = stanFormularza(s, `najmy/nowy?${new URLSearchParams(s.ui.zapytanie)}`, () => wartosciNowegoNajmu(s));
  const klienci = s.dane.clients.filter((k) => !k.archived).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    .map((k) => ({ wartosc: k.id, tekst: k.name }));
  if (!s.dane.units.some((j) => !j.archived)) {
    return pustyStan('Najpierw dodaj jednostkę.', [{ tekst: 'Dodaj jednostkę', href: '#/jednostki/nowa' }]);
  }
  const nowyKlient = `#/klienci/nowy?dalej=najem${f.wartosci.unit_id ? `&jednostka=${encodeURIComponent(f.wartosci.unit_id)}` : ''}`;

  return formularz(f, {
    nazwa: 'najem',
    przycisk: 'Zapisz najem',
    anuluj: s.ui.zapytanie.klient ? `#/klienci/${encodeURIComponent(s.ui.zapytanie.klient)}`
      : s.ui.zapytanie.jednostka ? `#/jednostki/${encodeURIComponent(s.ui.zapytanie.jednostka)}` : '#/klienci',
    tresc: `
      ${sekcja('Najem', `
        ${wybor(f, { nazwa: 'client_id', etykieta: 'Klient', opcje: klienci, wymagane: true, pusta: 'Wybierz klienta…' })}
        <p class="pod-polem"><a href="${nowyKlient}">+ Nowy klient</a></p>
        ${wybor(f, { nazwa: 'unit_id', etykieta: 'Jednostka', opcje: opcjeJednostek(s, dzisiaj(),
          { pokazZajete: zaznaczone(f.wartosci.pokaz_zajete), wybrana: f.wartosci.unit_id }),
          wymagane: true, pusta: 'Wybierz jednostkę…', odswiez: true,
          podpowiedz: 'Wolne i na wypowiedzeniu. Zajętą wybierzesz po zaznaczeniu „Inne – pokaż też zajęte”.' })}
        ${przelacznik(f, { nazwa: 'pokaz_zajete', etykieta: 'Inne – pokaż też zajęte jednostki', odswiez: true })}
        ${infoPrzejecia(f, s)}
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'start_on', etykieta: 'Data startu', typ: 'date', wymagane: true, odswiez: true })}
          ${pole(f, { nazwa: 'amount_gr', etykieta: 'Stawka (zł / mies.)', typ: 'kwota', wymagane: true, odswiez: true,
            podpowiedz: 'Normalna stawka, podpowiedź z cennika jednostki.' })}
        </div>
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'billing_day', etykieta: 'Dzień płatności', typ: 'number', wymagane: true,
            podpowiedz: 'Termin zapłaty za cały bieżący miesiąc (okresy to miesiące kalendarzowe). 29–31: w krótszym miesiącu ostatni dzień.', atrybuty: 'min="1" max="31"' })}
          ${wybor(f, { nazwa: 'period_months', etykieta: 'Okres rozliczeniowy',
            opcje: OKRESY_ROZLICZENIOWE.map((m) => ({ wartosc: m, tekst: NAZWY_OKRESOW[m] })) })}
        </div>
        ${wybor(f, { nazwa: 'last_period', etykieta: 'Ostatni okres przy końcu najmu', opcje: OSTATNI_OKRES })}`)}
      ${sekcja('Promocja', polaPromocjiNajmu(f, s))}
      ${sekcja('Płatność – gdzie klient wpłaca', polaPlatnosci(f, s, { wymagajKonta: true }))}
      ${sekcja('Umowa', `
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'number', etykieta: 'Numer umowy', atrybuty: 'autocomplete="off"',
            podpowiedz: 'Numer istniejącej umowy tego klienta dopisze jednostkę do tamtej umowy.' })}
          ${pole(f, { nazwa: 'signed_on', etykieta: 'Data podpisania', typ: 'date' })}
        </div>
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'valid_until', etykieta: 'Umowa do', typ: 'date', podpowiedz: 'Puste = czas nieokreślony.' })}
          ${pole(f, { nazwa: 'notice_period', etykieta: 'Okres wypowiedzenia', podpowiedz: 'Informacyjnie, np. 1 miesiąc.' })}
        </div>
        ${plik(f, { nazwa: 'pdf', etykieta: 'Umowa (PDF, do 10 MB)', akceptuj: 'application/pdf,.pdf' })}`)}
      ${sekcja('Kaucja', bezKaucji(s.indeksy.jednostki.get(f.wartosci.unit_id)?.type)
    ? '<p class="podpowiedz">Boxy wynajmujemy bez kaucji.</p>' : `
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'deposit_gr', etykieta: 'Kwota kaucji (zł)', typ: 'kwota', podpowiedz: 'Puste = bez kaucji.' })}
          ${pole(f, { nazwa: 'deposit_on', etykieta: 'Data przyjęcia', typ: 'date', podpowiedz: 'Domyślnie data podpisania albo startu.' })}
        </div>
        ${opcje(f, { nazwa: 'deposit_method', legenda: 'Forma kaucji', opcje: FORMY })}
        <p class="podpowiedz">Kaucja nie jest przychodem (Z26).</p>`)}`,
  });
}

/**
 * Promocja wybrana w nowym najmie: { bledy, wybrana: null | { id, nazwa, rabat, okresy, nowa } }.
 * '' = bez promocji, 'inna' = własne warunki (opcjonalnie dopisane do listy).
 */
function promocjaNowegoNajmu(w, s) {
  if (!w.promo) return { bledy: {}, wybrana: null };
  if (w.promo === 'inna') {
    const { bledy, rabat, okresy } = czytajWarunki(w, { rabat: 'promo_rabat', okresy: 'promo_okresy' });
    const nazwa = String(w.promo_nazwa ?? '').trim();
    if (nazwa.length > 60) bledy.promo_nazwa = 'Nazwa do 60 znaków.';
    if (Object.keys(bledy).length) return { bledy, wybrana: null };
    const lista = listaPromocji(ustawienia(s));
    const pozycja = nowaPozycja(lista, { nazwa, rabat, okresy });
    return { bledy, wybrana: { ...pozycja, nazwa: nazwa || `promocja ${opisWarunkow({ rabat, okresy })}`, nowa: pozycja } };
  }
  const p = listaPromocji(ustawienia(s)).find((x) => x.id === w.promo);
  if (!p) return { bledy: { promo: 'Tej promocji nie ma już na liście. Wybierz inną.' }, wybrana: null };
  return { bledy: {}, wybrana: { ...p, rabat: Number(p.rabat), okresy: Number(p.okresy), nowa: null } };
}

/** Najem z pól formularza – do wyliczenia końca promocji przed zapisem. */
function najemZFormularza(w, s) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(w.start_on ?? '') ? w.start_on : null;
  const dzien = Number(w.billing_day || ustawienia(s).default_billing_day || 20);
  const okres = Number(w.period_months || 1);
  if (!start || !Number.isInteger(dzien) || dzien < 1 || dzien > 31 || !OKRESY_ROZLICZENIOWE.includes(okres)) return null;
  return { id: 'nowy', start_on: start, end_on: null, billing_day: dzien, period_months: okres };
}

function polaPromocjiNajmu(f, s) {
  const w = f.wartosci;
  const opcjeListy = [...opcjePromocji(s), { wartosc: 'inna', tekst: 'Inna…' }];
  let html = wybor(f, { nazwa: 'promo', etykieta: 'Promocja', opcje: opcjeListy, pusta: 'Bez promocji', odswiez: true,
    podpowiedz: 'Obniżona stawka na pierwsze okresy, potem stawka z pola „Stawka”. Listę zmienisz w Ustawieniach → Promocje.' });
  if (w.promo === 'inna') {
    html += `${pole(f, { nazwa: 'promo_nazwa', etykieta: 'Nazwa promocji', atrybuty: 'maxlength="60"',
      podpowiedz: 'Np. „Zniżka dla stałego klienta”. Puste = opis z rabatu.' })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'promo_rabat', etykieta: 'Rabat (%)', wymagane: true, odswiez: true, atrybuty: 'inputmode="decimal"' })}
        ${pole(f, { nazwa: 'promo_okresy', etykieta: 'Ile okresów', wymagane: true, odswiez: true, atrybuty: 'inputmode="numeric"' })}
      </div>
      ${przelacznik(f, { nazwa: 'promo_zapisz', etykieta: 'Dodaj tę promocję do listy' })}`;
  }
  const { wybrana } = promocjaNowegoNajmu(w, s);
  const najem = najemZFormularza(w, s);
  const normalna = parseKwota(w.amount_gr);
  if (wybrana && najem && normalna > 0) {
    const plan = planPromocji(najem, { normalnaGr: normalna, rabat: wybrana.rabat, okresy: wybrana.okresy });
    if (plan) html += podgladPromocji(plan.promocyjnaGr, wybrana.okresy, plan.poczatek, normalna, plan.koniec);
  }
  return html;
}

/** Podpowiedzi przy zmianie pól (8.6): stawka z cennika, dzień płatności z daty startu, PDF od razu sprawdzony. */
function przyZmianieNajmu(nazwa, f, s, poprzednie = {}) {
  const w = f.wartosci;
  if (nazwa === 'unit_id') {
    const stary = s.indeksy.jednostki.get(poprzednie.unit_id);
    const nowy = s.indeksy.jednostki.get(w.unit_id);
    if (nowy?.list_price_gr != null && (!poprzednie.amount_gr || poprzednie.amount_gr === kwotaDoPola(stary?.list_price_gr))) {
      w.amount_gr = kwotaDoPola(nowy.list_price_gr);
    }
    delete f.bledy.unit_id;
  }
  // Jednostka na wypowiedzeniu: start najwcześniej dzień po końcu obecnego najmu.
  if (nazwa === 'unit_id' && w.unit_id) {
    const kol = kolizjeJednostki(s, w.unit_id, w.start_on || dzisiaj());
    const koniec = kol.length === 1 ? planowanyKoniec(kol[0], dzisiaj()) : null;
    if (koniec && (!w.start_on || w.start_on <= koniec)) w.start_on = dodajDni(koniec, 1);
  }
  if (nazwa === 'wypowiedz_do') f.wypowiedzDoZmienione = true;
  if (!f.wypowiedzDoZmienione && (nazwa === 'unit_id' || nazwa === 'start_on' || nazwa === 'pokaz_zajete' || !w.wypowiedz_do)) {
    w.wypowiedz_do = domyslneWypowiedzDo(w.start_on);
  }
  // Dzień płatności nie zależy od daty startu (decyzja 11.11: wszyscy płacą 20.) – podpowiedź z Ustawień.
  if (nazwa === 'pdf') {
    const blad = walidujPdf(f.pliki.pdf);
    if (blad) f.bledy.pdf = blad; else delete f.bledy.pdf;
  }
}

async function zapiszNajem(form, ctx) {
  const s = ctx.state;
  const f = s.ui.form;
  const w = wartosciFormularza(form);
  const umowaPdf = f.pliki.pdf ?? null;
  // Przejęcie jednostki od obecnego najemcy (prośba 11.11): jego najem kończy się dzień przed startem nowego.
  const przejecie = przejecieJednostki(s, w.unit_id, w.start_on);
  const bledyPrzejecia = {};
  if (przejecie?.blad) bledyPrzejecia.unit_id = przejecie.blad;
  else if (przejecie && !przejecie.wypowiedziany) {
    if (!zaznaczone(w.pokaz_zajete)) bledyPrzejecia.unit_id = 'Jednostka jest zajęta – zaznacz „Inne – pokaż też zajęte”, żeby ją przejąć.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(w.wypowiedz_do ?? '')) bledyPrzejecia.wypowiedz_do = 'Podaj termin wypowiedzenia.';
    else if (w.wypowiedz_do >= w.start_on) bledyPrzejecia.wypowiedz_do = 'Termin musi być przed startem nowego najmu.';
  }
  const wynik = walidujNajem(w, { indeksy: s.indeksy, ustawienia: ustawienia(s), plik: umowaPdf,
    przejmowany: przejecie && !przejecie.blad ? przejecie.najem : null });
  const promocja = promocjaNowegoNajmu(w, s);
  if (maBledy(ctx, w, { ...(wynik.bledy ?? {}), ...promocja.bledy, ...bledyPrzejecia })) return;
  if (promocja.wybrana) {
    // Stawka startowa → obniżona od startu + normalna od końca promocji (dwa wiersze rental_rates w tym samym pakiecie).
    const najem = wynik.pakiet.rentals[0];
    const normalna = wynik.pakiet.rental_rates[0].amount_gr;
    const plan = planPromocji(najem, { normalnaGr: normalna, rabat: promocja.wybrana.rabat, okresy: promocja.wybrana.okresy });
    wynik.pakiet.rental_rates = wierszeStawek(najem.id, plan, normalna, promocja.wybrana.nazwa);
  }
  const jednostka = s.indeksy.jednostki.get(w.unit_id);
  const klientId = w.client_id;

  await zapisz(ctx, async () => {
    // Najpierw koniec obecnego najmu (baza nie pozwala na dwa najmy jednostki w tym samym czasie), potem nowy najem.
    let stary = null;
    if (przejecie?.najem) {
      const koniec = przejecie.koniec ?? dodajDni(w.start_on, -1);
      stary = przejecie.najem;
      ctx.scal({ rentals: [await ctx.db.zmien('rentals', stary.id, { end_on: koniec })] });
    }
    try {
      ctx.scal(await ctx.db.zapiszPakiet(wynik.pakiet));
    } catch (e) {
      if (stary) ctx.scal({ rentals: [await ctx.db.zmien('rentals', stary.id, { end_on: stary.end_on ?? null })] });
      throw e;
    }
    let komunikat = `Dodano najem ${jednostka.code}${promocja.wybrana ? ` z promocją „${promocja.wybrana.nazwa}”` : ''}`;
    if (stary && !przejecie.wypowiedziany && przejecie.klient) {
      const nowy = s.indeksy.klienci.get(klientId)?.name ?? 'nowy klient';
      try {
        ctx.scal({ client_notes: [await ctx.db.wstaw('client_notes', {
          client_id: przejecie.klient.id, kind: 'notatka', task_owner: 'ja', promised_on: w.wypowiedz_do,
          body: `Wypowiedz umowę – ${jednostka.code} od ${formatData(w.start_on)} wynajmuje ${nowy}. Najem kończy się ${
            formatData(dodajDni(w.start_on, -1))}: złóż wypowiedzenie, potem „Zakończ najem” i rozlicz kaucję.`,
        })] });
        komunikat += `; zadanie: wypowiedz umowę ${przejecie.klient.name} do ${formatData(w.wypowiedz_do)}`;
      } catch (e) {
        komunikat += `, ale zadanie wypowiedzenia nie zapisało się (${e.message})`;
      }
    }
    if (promocja.wybrana?.nowa && zaznaczone(w.promo_zapisz)) {
      try {
        const lista = [...listaPromocji(ustawienia(s)), promocja.wybrana.nowa];
        ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { promotions: lista }) });
      } catch (e) {
        komunikat += `, ale promocja nie została dodana do listy (${e.message})`;
      }
    }
    // Domyślnie baza zapisuje „przelew, konto nieustalone”; inne miejsce płatności – osobna zmiana najmu.
    if (wynik.platnosc.pay_method !== 'przelew' || wynik.platnosc.bank_account_id) {
      try {
        ctx.scal({ rentals: [await ctx.db.zmien('rentals', wynik.najemId, wynik.platnosc)] });
      } catch (e) {
        komunikat += `, ale miejsce płatności nie zostało zapisane (${e.message})`;
      }
    }
    if (umowaPdf) {
      try {
        const sciezka = await ctx.db.wgrajUmowe(s.uzytkownik.id, wynik.umowaId, umowaPdf);
        ctx.scal({ contracts: [await ctx.db.zmien('contracts', wynik.umowaId, { pdf_path: sciezka })] });
      } catch (e) {
        komunikat += `, ale PDF nie został wgrany (${e.message}). Dodaj go w sekcji Dokumenty`;
      }
    }
    ctx.toast(komunikat);
    // Karta klienta z paskiem „Dalej: umowa do podpisania · brama”.
    ctx.nawiguj(`klienci/${encodeURIComponent(klientId)}?nowy=${encodeURIComponent(wynik.najemId)}`);
  });
}

// ---------------------------------------------------------------------
// Zmiana stawki: jeden najem
// ---------------------------------------------------------------------

/** Pola wspólne dla zmiany jednej i wielu stawek. */
function polaZmiany(f) {
  const tryb = TRYBY_STAWKI[f.wartosci.tryb] ? f.wartosci.tryb : 'kwota';
  const etykiety = { kwota: 'Nowa stawka (zł / mies.)', procent: 'Zmiana (%)', zl: 'Zmiana (zł)' };
  return `
    ${pole(f, { nazwa: 'valid_from', etykieta: 'Obowiązuje od dnia', typ: 'date', wymagane: true,
      podpowiedz: 'Nowa stawka obowiązuje od pierwszego okresu, który zaczyna się tego dnia lub później (Z13).' })}
    ${opcje(f, { nazwa: 'tryb', legenda: 'Sposób zmiany', odswiez: true,
      opcje: Object.entries(TRYBY_STAWKI).map(([wartosc, tekst]) => ({ wartosc, tekst })) })}
    ${pole(f, { nazwa: 'wartosc', etykieta: etykiety[tryb], typ: 'kwota', wymagane: true,
      podpowiedz: tryb === 'kwota' ? null : 'Obniżka ze znakiem minus, np. -5.' })}
    ${przelacznik(f, { nazwa: 'zaokraglij', etykieta: 'Zaokrąglij do pełnych złotych' })}
    ${pole(f, { nazwa: 'reason', etykieta: 'Powód', podpowiedz: 'Np. waloryzacja 2027. Puste = „podwyżka”.' })}`;
}

const zmianaTekst = (p) => `${p.staraGr != null ? formatZl(p.staraGr) : '—'} → ${formatZl(p.nowaGr)}`;

function formularzStawki(s, k) {
  const f = stanFormularza(s, `najmy/${k.najem.id}/stawka`, () => ({
    valid_from: pierwszyNastepnegoMiesiaca(dzisiaj()), tryb: 'kwota', zaokraglij: 'on',
  }));
  const p = f.podglad;
  const podglad = p ? `<div class="podglad" role="status">
      <strong>${esc(k.jednostka?.code ?? '')}: ${zmianaTekst(p)}</strong>
      <span>od okresu ${formatData(p.pierwszyOkres)}${p.zastepuje ? ' · zastąpi stawkę wpisaną na ten dzień' : ''}</span></div>` : '';
  const historia = k.stawki.length ? `<section class="karta"><h2>Historia stawek</h2><ul class="lista">${k.stawki.map((st) => `
    <li><div class="wiersz"><div class="glowna"><strong>od ${formatData(st.valid_from)}</strong>
      <span>${esc(st.reason ?? '')}</span></div><div class="prawa kwota">${formatZl(st.amount_gr)}</div></div></li>`).join('')}
    </ul></section>` : '';

  return `${naglowekNajmu(s, k)}
    <div class="siatka">
      ${formularz(f, {
        nazwa: 'stawka', przycisk: 'Zapisz stawkę', drugiPrzycisk: { tekst: 'Pokaż podgląd', wartosc: 'podglad' },
        anuluj: k.klient ? `#/klienci/${encodeURIComponent(k.klient.id)}` : '#/klienci',
        tresc: polaZmiany(f) + podglad,
      })}
      ${historia}
    </div>`;
}

async function zapiszStawke(form, ctx, ev) {
  const s = ctx.state;
  const k = kontekstNajmu(s, s.ui.parametr);
  const w = wartosciFormularza(form);
  const { bledy, wiersz, podglad } = walidujZmianeStawki(w, { najem: k.najem, stawki: k.stawki });
  s.ui.form.podglad = podglad?.blad ? null : podglad ?? null;
  if (maBledy(ctx, w, bledy)) return;
  if (ev.submitter?.value === 'podglad') {
    ctx.render();
    return;
  }
  await zapisz(ctx, async () => {
    ctx.scal({ rental_rates: await ctx.db.zapiszWiele('rental_rates', [wiersz], 'rental_id,valid_from') });
    // Komunikat jak w 12.2: „Nowa stawka G-03: 330 zł od okresu 15.07.2026”
    ctx.toast(`Nowa stawka ${k.jednostka?.code ?? ''}: ${formatZl(wiersz.amount_gr, { grosze: wiersz.amount_gr % 100 !== 0 })} od okresu ${formatData(podglad.pierwszyOkres)}`);
    ctx.nawiguj(k.klient ? `klienci/${encodeURIComponent(k.klient.id)}` : 'klienci');
  });
}

// ---------------------------------------------------------------------
// Zmiana stawek wielu najmów naraz
// ---------------------------------------------------------------------

/** Najmy, które trwają w dniu „od” lub zaczynają się później, opcjonalnie tylko jednego typu jednostek. */
function kandydaciPodwyzki(s, od, typ) {
  return s.dane.rentals
    .filter((n) => n.end_on == null || n.end_on >= od)
    .map((n) => ({ n, j: s.indeksy.jednostki.get(n.unit_id) }))
    .filter(({ j }) => j && (!typ || j.type === typ))
    .sort((a, b) => porownajKody(a.j.code, b.j.code))
    .map(({ n }) => n);
}

const dataLubDzis = (tekst) => (/^\d{4}-\d{2}-\d{2}$/.test(tekst ?? '') ? tekst : dzisiaj());

function formularzPodwyzki(s) {
  const f = stanFormularza(s, 'najmy/podwyzka', () => {
    const od = pierwszyNastepnegoMiesiaca(dzisiaj());
    return { valid_from: od, tryb: 'procent', zaokraglij: 'on', typ: '', najmy: kandydaciPodwyzki(s, od, '').map((n) => n.id) };
  });
  const kandydaci = kandydaciPodwyzki(s, dataLubDzis(f.wartosci.valid_from), f.wartosci.typ);
  if (!kandydaci.length && !f.wartosci.typ) return pustyStan('Brak trwających najmów.', [{ tekst: 'Wróć do jednostek', href: '#/jednostki' }]);

  const zaznaczone = new Set([].concat(f.wartosci.najmy ?? []));
  const pozycje = new Map((f.podglad ?? []).map((p) => [p.najem.id, p]));
  const dzien = dzisiaj();
  const wiersze = kandydaci.map((n) => {
    const j = s.indeksy.jednostki.get(n.unit_id);
    const klient = s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);
    const obecna = stawkaNaDzien(s.indeksy.stawkiNajmu.get(n.id), dzien < n.start_on ? n.start_on : dzien);
    const p = pozycje.get(n.id);
    const id = `f-najmy-${n.id}`;
    return `<li><label class="wiersz-wyboru" for="${id}">
      <input type="checkbox" id="${id}" name="najmy" value="${esc(n.id)}"${zaznaczone.has(n.id) ? ' checked' : ''}>
      <span class="glowna"><strong class="mono">${esc(j.code)}</strong> <span>${esc(klient?.name ?? '—')}</span></span>
      <span class="prawa">${p
        ? p.blad ? `<span class="blad">${esc(p.blad)}</span>`
          : `<span class="kwota">${zmianaTekst(p)}</span><span class="maly wyciszony">od ${formatData(p.pierwszyOkres)}</span>`
        : `<span class="kwota">${obecna != null ? formatZl(obecna) : '—'}</span>`}</span>
    </label></li>`;
  }).join('');
  const liczba = [...zaznaczone].filter((id) => kandydaci.some((n) => n.id === id)).length;
  const typy = [{ wartosc: '', tekst: 'Wszystkie' },
    ...Object.entries(TYPY_JEDNOSTEK).map(([wartosc, t]) => ({ wartosc, tekst: t.mnoga }))];

  return formularz(f, {
    nazwa: 'podwyzka',
    przycisk: `Zapisz zmianę ${liczba} ${liczba === 1 ? 'najmu' : 'najmów'}`,
    drugiPrzycisk: { tekst: 'Pokaż podgląd', wartosc: 'podglad' },
    anuluj: '#/jednostki',
    tresc: `${polaZmiany(f)}
      ${sekcja('Najmy', `
        ${wybor(f, { nazwa: 'typ', etykieta: 'Typ jednostek', opcje: typy, odswiez: true })}
        <div class="pasek-akcji maly">
          <button type="button" class="link-btn" data-akcja="zaznacz-wszystkie">Zaznacz wszystkie</button>
          <button type="button" class="link-btn" data-akcja="odznacz-wszystkie">Odznacz wszystkie</button>
        </div>
        ${f.bledy.najmy ? `<p id="f-najmy-blad" class="blad" role="alert">${esc(f.bledy.najmy)}</p>` : ''}
        <ul class="lista lista-wyboru" aria-label="Najmy do zmiany stawki"${f.bledy.najmy ? ' aria-describedby="f-najmy-blad"' : ''}>${
  wiersze || '<li class="wyciszony">Brak najmów tego typu.</li>'}</ul>
        <p class="podpowiedz">Zmiana cennika jednostek nie zmienia trwających najmów (Z12) – stawki zmienia się tutaj.</p>`)}`,
  });
}

async function zapiszPodwyzke(form, ctx, ev) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const najmy = kandydaciPodwyzki(s, dataLubDzis(w.valid_from), w.typ);
  const { bledy, pozycje, wiersze } = walidujPodwyzke(w, { najmy, stawkiNajmu: s.indeksy.stawkiNajmu });
  s.ui.form.podglad = pozycje.length ? pozycje : null;
  if (maBledy(ctx, w, bledy)) return;
  if (ev.submitter?.value === 'podglad') {
    ctx.render();
    return;
  }
  await zapisz(ctx, async () => {
    ctx.scal({ rental_rates: await ctx.db.zapiszWiele('rental_rates', wiersze, 'rental_id,valid_from') });
    ctx.toast(`Nowe stawki dla ${wiersze.length} ${wiersze.length === 1 ? 'najmu' : 'najmów'} od ${formatData(w.valid_from)}`);
    ctx.nawiguj('jednostki');
  });
}

// ---------------------------------------------------------------------
// Zakończenie najmu
// ---------------------------------------------------------------------

/** Kaucję rozlicza się przy końcu ostatniego trwającego najmu w umowie. null, gdy nie tutaj. */
function kaucjaDoRozliczenia(s, k) {
  const inneTrwajace = s.dane.rentals.some((n) => n.contract_id === k.umowa?.id && n.id !== k.najem.id && n.end_on == null);
  if (!k.umowa || inneTrwajace) return null;
  const kaucja = saldoKaucji(s.dane.deposits, k.umowa.id);
  return kaucja.saldoGr > 0 ? kaucja : null;
}

function formularzKonca(s, k) {
  const f = stanFormularza(s, `najmy/${k.najem.id}/koniec`, () => ({
    end_on: k.najem.end_on ?? k.najem.notice_end_on ?? dzisiaj(), last_period: k.najem.last_period, zwrot_metoda: 'gotowka', zatrzymanie_powod: '',
  }));
  const kaucja = kaucjaDoRozliczenia(s, k);
  const inneTrwajace = k.umowa && s.dane.rentals.some((n) => n.contract_id === k.umowa.id && n.id !== k.najem.id && n.end_on == null);
  const n = f.podglad;
  const podglad = n ? `<div class="podglad" role="status"><strong>Ostatnia należność: ${formatZl(n.kwotaGr)}</strong>
      <span>okres ${formatData(n.poczatek)} – ${formatData(n.koniec)}${n.rodzaj === 'ostatni-niepelny'
        ? ` · ${n.dni} z ${n.dniOkresu} dni` : ''}${f.wartosci.last_period === 'pelny' && n.rodzaj === 'ostatni-niepelny' ? ' · pełny okres' : ''}</span></div>` : '';

  const czescKaucji = kaucja ? sekcja('Kaucja', `
      <p>Kaucja do rozliczenia: ${kwotaPodgladu(kaucja.saldoGr)} (${kaucja.metoda === 'przelew' ? 'przelew' : 'gotówka'}).
        Zwrot i zatrzymanie razem nie mogą jej przekroczyć.</p>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'zwrot_gr', etykieta: 'Zwrot (zł)', typ: 'kwota' })}
        ${opcje(f, { nazwa: 'zwrot_metoda', legenda: 'Forma zwrotu', opcje: FORMY })}
      </div>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'zatrzymanie_gr', etykieta: 'Zatrzymanie (zł)', typ: 'kwota',
          podpowiedz: 'Zatrzymana kaucja jest przychodem w dniu zatrzymania (Z26).' })}
        ${wybor(f, { nazwa: 'zatrzymanie_powod', etykieta: 'Powód zatrzymania', pusta: '—',
          opcje: Object.entries(POWODY_ZATRZYMANIA).map(([wartosc, tekst]) => ({ wartosc, tekst })),
          podpowiedz: 'Na zaległy czynsz – zmniejsza zaległość klienta.' })}
      </div>
      ${pole(f, { nazwa: 'deposit_on', etykieta: 'Data rozliczenia kaucji', typ: 'date', podpowiedz: 'Domyślnie data końca najmu.' })}`)
    : inneTrwajace ? '<p class="podpowiedz">Kaucja zostaje przy umowie – rozliczysz ją przy końcu ostatniego najmu w tej umowie.</p>' : '';

  return `${naglowekNajmu(s, k)}
    ${formularz(f, {
      nazwa: 'koniec', przycisk: 'Zakończ najem', drugiPrzycisk: { tekst: 'Pokaż ostatnią należność', wartosc: 'podglad' },
      anuluj: k.klient ? `#/klienci/${encodeURIComponent(k.klient.id)}` : '#/klienci',
      tresc: `
        ${pole(f, { nazwa: 'end_on', etykieta: 'Data końca najmu', typ: 'date', wymagane: true,
          podpowiedz: 'Ostatni dzień najmu. Przyszłe należności po tej dacie znikną.' })}
        ${opcje(f, { nazwa: 'last_period', legenda: 'Ostatni okres (Z8)', opcje: OSTATNI_OKRES })}
        ${podglad}
        ${czescKaucji}`,
    })}`;
}

async function zapiszKoniec(form, ctx, ev) {
  const s = ctx.state;
  const k = kontekstNajmu(s, s.ui.parametr);
  const w = wartosciFormularza(form);
  const wynik = walidujKoniec(w, {
    najem: k.najem, umowa: k.umowa, stawki: k.stawki, korekty: k.korekty,
    najmyJednostki: s.indeksy.najmyJednostki.get(k.najem.unit_id) ?? [],
    kaucja: kaucjaDoRozliczenia(s, k), ustawienia: ustawienia(s), dzis: dzisiaj(),
  });
  s.ui.form.podglad = wynik.ostatniaNaleznosc;
  if (maBledy(ctx, w, wynik.bledy)) return;
  if (ev.submitter?.value === 'podglad') {
    ctx.render();
    return;
  }
  await zapisz(ctx, async () => {
    ctx.scal(await ctx.db.zapiszPakiet(wynik.pakiet));
    ctx.toast(`Najem ${k.jednostka?.code ?? ''} zakończony ${formatData(w.end_on)}`);
    ctx.nawiguj(k.klient ? `klienci/${encodeURIComponent(k.klient.id)}` : 'klienci');
  });
}

// ---------------------------------------------------------------------
// Korekta należności
// ---------------------------------------------------------------------

/** Należności najmu do wyboru okresu: od data_start do 3 miesięcy w przód. */
function naleznosciDoKorekty(s, k) {
  const u = ustawienia(s);
  return naleznosciNajmu(k.najem, { stawki: k.stawki, korekty: k.korekty, dataStart: u.data_start, dzis: dzisiaj() })
    .filter((n) => n.poczatek <= dodajMiesiace(dzisiaj(), 3));
}

function formularzKorekty(s, k) {
  const naleznosci = naleznosciDoKorekty(s, k);
  const dzien = dzisiaj();
  const biezacy = [...naleznosci].reverse().find((n) => n.poczatek <= dzien) ?? naleznosci[0];
  const naKwote = s.ui.zapytanie.tryb === 'kwota';
  const f = stanFormularza(s, `najmy/${k.najem.id}/korekta`, () => ({
    tryb: naKwote ? 'kwota' : 'roznica',
    // „Kwota 1. okresu” z karty klienta: pierwszy okres; zwykła korekta: bieżący.
    period_start: (naKwote ? naleznosci[0] : biezacy)?.poczatek ?? '',
  }));
  const kwotaOkresu = naleznosci.find((n) => n.poczatek === f.wartosci.period_start);
  if (!naleznosci.length) {
    return `${naglowekNajmu(s, k)}${pustyStan(`Najem nie ma należności od ${formatData(ustawienia(s).data_start)}.`)}`;
  }
  const okresy = [...naleznosci].reverse().map((n) => ({
    wartosc: n.poczatek,
    tekst: `${formatData(n.poczatek)} – ${formatData(n.koniec)} · ${formatZl(n.kwotaGr)}${n.korektaGr ? ` (w tym korekta ${formatZl(n.korektaGr)})` : ''}`,
  }));
  const dotychczas = [...k.korekty].sort((a, b) => b.period_start.localeCompare(a.period_start));

  return `${naglowekNajmu(s, k)}
    <div class="siatka">
      ${formularz(f, {
        nazwa: 'korekta', przycisk: 'Zapisz korektę',
        anuluj: k.klient ? `#/klienci/${encodeURIComponent(k.klient.id)}` : '#/klienci',
        tresc: `
          ${wybor(f, { nazwa: 'period_start', etykieta: 'Okres', opcje: okresy, wymagane: true, odswiez: true })}
          ${opcje(f, { nazwa: 'tryb', legenda: 'Jak zmienić', odswiez: true, opcje: [
    { wartosc: 'kwota', tekst: 'Ustaw kwotę należności' }, { wartosc: 'roznica', tekst: 'Zmień o kwotę (+/−)' }] })}
          ${f.wartosci.tryb === 'kwota'
    ? pole(f, { nazwa: 'nowa_kwota', etykieta: 'Należność za ten okres (zł)', typ: 'kwota', wymagane: true,
      podpowiedz: `Teraz: ${kwotaOkresu ? formatZl(kwotaOkresu.kwotaGr) : '—'}. Np. kwota, którą klient faktycznie miał zapłacić za niepełny pierwszy miesiąc.` })
    : pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota korekty (zł)', typ: 'kwota', wymagane: true,
      podpowiedz: 'Ujemna = rabat lub umorzenie, np. -50. Dodatnia = dopłata. Należność nie może spaść poniżej 0 zł.' })}
          ${pole(f, { nazwa: 'reason', etykieta: 'Powód', wymagane: f.wartosci.tryb !== 'kwota', atrybuty: 'maxlength="200"',
    podpowiedz: f.wartosci.tryb === 'kwota' ? 'Puste = „Ręczna kwota okresu”.' : '' })}`,
      })}
      <section class="karta"><h2>Dotychczasowe korekty</h2>
        ${dotychczas.length ? `<ul class="lista">${dotychczas.map((x) => `<li><div class="wiersz"><div class="glowna">
          <strong>okres od ${formatData(x.period_start)}</strong><span>${esc(x.reason)}</span></div>
          <div class="prawa kwota">${formatZl(x.amount_gr)}</div></div></li>`).join('')}</ul>`
          : '<p class="wyciszony">Brak korekt.</p>'}
      </section>
    </div>`;
}

async function zapiszKorekte(form, ctx) {
  const s = ctx.state;
  const k = kontekstNajmu(s, s.ui.parametr);
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujKorekte(w, { najem: k.najem, naleznosci: naleznosciDoKorekty(s, k) });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    ctx.scal({ charge_adjustments: [await ctx.db.wstaw('charge_adjustments', wiersz)] });
    ctx.toast(`Korekta ${k.jednostka?.code ?? ''} za okres od ${formatData(wiersz.period_start)}: ${formatZl(wiersz.amount_gr)}`);
    ctx.nawiguj(k.klient ? `klienci/${encodeURIComponent(k.klient.id)}` : 'klienci');
  });
}

// ---------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------


// ---------------------------------------------------------------------
// Promocja: rabat % na N okresów od wybranego okresu (np. -50% na 2 pierwsze miesiące).
// Zapis: dwie stawki w historii – obniżona od pierwszego okresu promocji i normalna od pierwszego
// okresu po promocji. Stawki wpisane w trakcie promocji są usuwane, późniejsze zostają.
// ---------------------------------------------------------------------

/** Powód stawki: nazwa promocji z listy (gdy warunki się zgadzają) albo „promocja −50% (2 okr.)”. */
function powodPromocji(s, id, { rabat, okresy }) {
  const p = listaPromocji(ustawienia(s)).find((x) => x.id === id);
  return p && Number(p.rabat) === rabat && Number(p.okresy) === okresy ? p.nazwa : `promocja ${opisWarunkow({ rabat, okresy })}`;
}

/** Wylicza promocję albo zwraca { bledy }. */
function policzPromocje(w, k) {
  const { bledy, rabat, okresy } = czytajWarunki(w);
  const normalna = parseKwota(w.normalna);
  if (normalna == null || normalna <= 0) bledy.normalna = 'Podaj normalną stawkę.';
  const od = /^\d{4}-\d{2}-\d{2}$/.test(w.od ?? '') ? w.od : null;
  if (!od) bledy.od = 'Podaj datę.';
  else if (od < k.najem.start_on) bledy.od = `Najem zaczyna się ${formatData(k.najem.start_on)}.`;
  if (Object.keys(bledy).length) return { bledy };

  const plan = planPromocji(k.najem, { normalnaGr: normalna, rabat, okresy, od });
  if (!plan) return { bledy: { od: 'Najem kończy się przed tą datą.' } };
  return { bledy, normalna, rabat, okresy, poczatek: plan.poczatek, koniecPromocji: plan.koniec, promocyjna: plan.promocyjnaGr, plan };
}

/** Podgląd promocji: „100 zł od 05.11.2026 do 19.01.2027 (niepełny okres i 2 pełne)”, „potem 200 zł od 20.01.2027”. */
function podgladPromocji(promocyjna, okresy, poczatek, normalna, koniec) {
  const zakres = koniec ? `od ${formatData(poczatek)} do ${formatData(dodajDni(koniec, -1))}` : `od ${formatData(poczatek)}`;
  return `<div class="podglad" role="status">
      <strong>${formatZl(promocyjna)} ${zakres}</strong>
      <span>${koniec ? `potem ${formatZl(normalna)} od ${formatData(koniec)} (${okresy} mies. od startu, do pełnego miesiąca)` : 'najem kończy się w trakcie promocji'}</span></div>`;
}

/** Opcje listy promocji (Ustawienia → Promocje). */
const opcjePromocji = (s) => listaPromocji(ustawienia(s)).map((p) => ({ wartosc: p.id, tekst: `${p.nazwa} (${opisWarunkow(p)})` }));

function formularzPromocji(s, k) {
  const dzien = dzisiaj();
  const obecna = stawkaNaDzien(k.stawki, najemTrwa(k.najem, dzien) ? dzien : k.najem.start_on);
  const cennik = k.jednostka?.list_price_gr ?? null;
  const pierwsza = listaPromocji(ustawienia(s))[0];
  const f = stanFormularza(s, `najmy/${k.najem.id}/promocja`, () => ({
    szablon: pierwsza?.id ?? '', normalna: kwotaDoPola(Math.max(cennik ?? 0, obecna ?? 0) || null),
    rabat: String(pierwsza?.rabat ?? 50), okresy: String(pierwsza?.okresy ?? 2), od: k.najem.start_on,
  }));
  const p = policzPromocje(f.wartosci, k);
  const podglad = p.promocyjna != null ? podgladPromocji(p.promocyjna, p.okresy, p.poczatek, p.normalna, p.koniecPromocji) : '';
  return `${naglowekNajmu(s, k)}
    ${formularz(f, {
    nazwa: 'promocja', przycisk: 'Zapisz promocję',
    anuluj: k.klient ? `#/klienci/${encodeURIComponent(k.klient.id)}` : '#/klienci',
    uwaga: 'Promocja zapisze się jako stawki w historii najmu. Stawki wpisane na czas promocji zostaną zastąpione.',
    tresc: `
      ${wybor(f, { nazwa: 'szablon', etykieta: 'Promocja', opcje: opcjePromocji(s), pusta: 'Własne warunki', odswiez: true,
    podpowiedz: 'Listę zmienisz w Ustawieniach → Promocje.' })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'normalna', etykieta: 'Normalna stawka (zł)', typ: 'kwota', wymagane: true, odswiez: true,
    podpowiedz: cennik ? `Cena z cennika: ${formatZl(cennik)}` : null })}
        ${pole(f, { nazwa: 'rabat', etykieta: 'Rabat (%)', wymagane: true, odswiez: true, atrybuty: 'inputmode="decimal"' })}
      </div>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'okresy', etykieta: 'Ile okresów', wymagane: true, odswiez: true, atrybuty: 'inputmode="numeric"' })}
        ${pole(f, { nazwa: 'od', etykieta: 'Od dnia', typ: 'date', wymagane: true, odswiez: true,
    podpowiedz: 'Promocja zaczyna się od pierwszego okresu od tego dnia.' })}
      </div>${podglad}`,
  })}`;
}

async function zapiszPromocje(form, ctx) {
  const s = ctx.state;
  const k = kontekstNajmu(s, s.ui.parametr);
  const w = wartosciFormularza(form);
  const p = policzPromocje(w, k);
  if (maBledy(ctx, w, p.bledy)) return;
  await zapisz(ctx, async () => {
    // Stawki wpisane w trakcie promocji (po jej początku, przed końcem) – usuwamy, żeby nie nadpisały rabatu.
    const wSrodku = k.stawki.filter((st) => st.valid_from > p.poczatek && (!p.koniecPromocji || st.valid_from < p.koniecPromocji));
    for (const st of wSrodku) await ctx.db.usun('rental_rates', st.id);
    const wiersze = wierszeStawek(k.najem.id, p.plan, p.normalna, powodPromocji(s, w.szablon, p));
    const zapisane = await ctx.db.zapiszWiele('rental_rates', wiersze, 'rental_id,valid_from');
    const usuniete = new Set(wSrodku.map((st) => st.id));
    s.dane = { ...s.dane, rental_rates: s.dane.rental_rates.filter((st) => !usuniete.has(st.id)) };
    ctx.scal({ rental_rates: zapisane });
    ctx.toast(`Promocja ${k.jednostka?.code ?? ''}: ${formatZl(p.promocyjna)} od ${formatData(p.poczatek)}`);
    ctx.nawiguj(k.klient ? `klienci/${encodeURIComponent(k.klient.id)}` : 'klienci');
  });
}

const FORMULARZE = {
  stawka: { tytul: 'Zmiana stawki', render: formularzStawki },
  koniec: { tytul: 'Koniec najmu', render: formularzKonca },
  korekta: { tytul: 'Korekta należności', render: formularzKorekty },
  promocja: { tytul: 'Promocja', render: formularzPromocji },
  platnosc: { tytul: 'Gdzie płaci', render: formularzPlatnosci },
};

/** Ekran nadrzędny dla „‹ wstecz” i podświetlonej zakładki. */
function nadrzedny(s) {
  const { parametr, zapytanie } = s.ui;
  if (parametr === 'podwyzka') return { href: '#/ustawienia', tekst: 'Ustawienia', zakladka: null };
  if (parametr === 'nowy') {
    if (zapytanie.klient && s.indeksy.klienci.has(zapytanie.klient)) {
      return { href: `#/klienci/${encodeURIComponent(zapytanie.klient)}`, tekst: s.indeksy.klienci.get(zapytanie.klient).name, zakladka: 'klienci' };
    }
    if (zapytanie.jednostka && s.indeksy.jednostki.has(zapytanie.jednostka)) {
      return { href: `#/jednostki/${encodeURIComponent(zapytanie.jednostka)}`, tekst: s.indeksy.jednostki.get(zapytanie.jednostka).code, zakladka: 'jednostki' };
    }
    return { href: '#/klienci', tekst: 'Klienci', zakladka: 'klienci' };
  }
  const k = kontekstNajmu(s, parametr);
  return k?.klient
    ? { href: `#/klienci/${encodeURIComponent(k.klient.id)}`, tekst: k.klient.name, zakladka: 'klienci' }
    : { href: '#/klienci', tekst: 'Klienci', zakladka: 'klienci' };
}

export default {
  zakladka: (s) => nadrzedny(s).zakladka,

  tytul(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'nowy') return 'Nowy najem';
    if (parametr === 'podwyzka') return 'Zmiana stawek';
    const kod = kontekstNajmu(s, parametr)?.jednostka?.code;
    return `${FORMULARZE[akcja]?.tytul ?? 'Najem'}${kod ? ` ${kod}` : ''}`;
  },

  wstecz: (s) => {
    const { href, tekst } = nadrzedny(s);
    return { href, tekst };
  },

  render(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'nowy') return formularzNowegoNajmu(s);
    if (parametr === 'podwyzka') return formularzPodwyzki(s);
    const k = kontekstNajmu(s, parametr);
    const widok = FORMULARZE[akcja];
    if (!k || !widok) return pustyStan('Nie znaleziono najmu.', [{ tekst: 'Klienci', href: '#/klienci' }]);
    return widok.render(s, k);
  },

  akcje: {
    'zaznacz-wszystkie'(el, ctx) {
      zaznaczWszystkie(el, ctx, true);
    },
    'odznacz-wszystkie'(el, ctx) {
      zaznaczWszystkie(el, ctx, false);
    },
  },

  przyZmianie: {
    najem: przyZmianieNajmu,
    /** Wybór promocji z listy wpisuje jej rabat i liczbę okresów. */
    promocja(nazwa, f, s) {
      if (nazwa !== 'szablon') return;
      const p = listaPromocji(ustawienia(s)).find((x) => x.id === f.wartosci.szablon);
      if (p) Object.assign(f.wartosci, { rabat: String(p.rabat).replace('.', ','), okresy: String(p.okresy) });
    },
    /** Zmiana typu jednostek w podwyżce zbiorczej: zaznacz wszystkie najmy tego typu, wyczyść podgląd. */
    podwyzka(nazwa, f, s) {
      if (nazwa !== 'typ') return;
      f.wartosci.najmy = kandydaciPodwyzki(s, dataLubDzis(f.wartosci.valid_from), f.wartosci.typ).map((n) => n.id);
      f.podglad = null;
    },
  },

  formularze: {
    najem: zapiszNajem,
    stawka: zapiszStawke,
    podwyzka: zapiszPodwyzke,
    koniec: zapiszKoniec,
    korekta: zapiszKorekte,
    promocja: zapiszPromocje,
    platnosc: zapiszPlatnosc,
  },
};

function zaznaczWszystkie(el, ctx, zaznacz) {
  const form = el.closest('form');
  const f = ctx.state.ui.form;
  if (!form || !f) return;
  f.wartosci = wartosciFormularza(form);
  f.wartosci.najmy = zaznacz
    ? kandydaciPodwyzki(ctx.state, dataLubDzis(f.wartosci.valid_from), f.wartosci.typ).map((n) => n.id) : [];
  ctx.render();
}
