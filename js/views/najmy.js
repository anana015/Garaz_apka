// Formularze najmu (8.6) – ekran bez własnej zakładki:
//   #/najmy/nowy[?klient=<id>&jednostka=<id>]   nowy najem (umowa, stawka, kaucja, PDF)
//   #/najmy/<id>/stawka                          zmiana stawki jednego najmu
//   #/najmy/<id>/koniec                          zakończenie najmu z rozliczeniem kaucji
//   #/najmy/<id>/korekta                         korekta należności (rabat, umorzenie, dopłata)
//   #/najmy/podwyzka                             zmiana stawek wielu najmów naraz

import { TYPY_JEDNOSTEK } from '../config.js';
import { biezacyNajem, najemTrwa, stawkaNaDzien } from '../dane.js';
import {
  formularz, kwotaPodgladu, maBledy, opcje, plik, pole, przelacznik, sekcja, stanFormularza, wartosciFormularza,
  wybor, zapisz,
} from '../formularz.js';
import { naleznosciNajmu } from '../okresy.js';
import { pustyStan } from '../ui.js';
import {
  esc, dodajMiesiace, dzisiaj, formatData, formatZl, iso, kwotaDoPola, porownajKody,
} from '../utils.js';
import {
  OKRESY_ROZLICZENIOWE, POWODY_ZATRZYMANIA, TRYBY_STAWKI, saldoKaucji, walidujKoniec, walidujKorekte,
  walidujNajem, walidujPdf, walidujPodwyzke, walidujZmianeStawki,
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
  </dl></section>`;
}

// ---------------------------------------------------------------------
// Nowy najem
// ---------------------------------------------------------------------

function opcjeJednostek(s, dzien) {
  return s.dane.units.filter((j) => !j.archived)
    .sort((a, b) => Object.keys(TYPY_JEDNOSTEK).indexOf(a.type) - Object.keys(TYPY_JEDNOSTEK).indexOf(b.type)
      || porownajKody(a.code, b.code))
    .map((j) => {
      const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzien);
      const klient = najem && s.indeksy.klienci.get(s.indeksy.umowy.get(najem.contract_id)?.client_id);
      const stan = j.out_of_service ? 'wyłączona' : najem ? `zajęta – ${klient?.name ?? '?'}` : 'wolna';
      return { wartosc: j.id, tekst: `${j.code} (${stan})`, grupa: TYPY_JEDNOSTEK[j.type]?.mnoga };
    });
}

function wartosciNowegoNajmu(s) {
  const dzien = dzisiaj();
  const { klient = '', jednostka = '' } = s.ui.zapytanie;
  const cennik = s.indeksy.jednostki.get(jednostka)?.list_price_gr;
  return {
    client_id: klient, unit_id: jednostka, start_on: dzien, billing_day: String(Number(dzien.slice(8))),
    amount_gr: kwotaDoPola(cennik), period_months: '1', last_period: ustawienia(s).default_last_period,
    deposit_method: 'gotowka',
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
        ${wybor(f, { nazwa: 'unit_id', etykieta: 'Jednostka', opcje: opcjeJednostek(s, f.wartosci.start_on || dzisiaj()),
          wymagane: true, pusta: 'Wybierz jednostkę…', odswiez: true })}
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'start_on', etykieta: 'Data startu', typ: 'date', wymagane: true, odswiez: true })}
          ${pole(f, { nazwa: 'amount_gr', etykieta: 'Stawka (zł / mies.)', typ: 'kwota', wymagane: true,
            podpowiedz: 'Podpowiedź z cennika jednostki.' })}
        </div>
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'billing_day', etykieta: 'Dzień płatności', typ: 'number', wymagane: true,
            podpowiedz: 'Czynsz płatny z góry (Z4). 29–31: w krótszym miesiącu ostatni dzień.', atrybuty: 'min="1" max="31"' })}
          ${wybor(f, { nazwa: 'period_months', etykieta: 'Okres rozliczeniowy',
            opcje: OKRESY_ROZLICZENIOWE.map((m) => ({ wartosc: m, tekst: NAZWY_OKRESOW[m] })) })}
        </div>
        ${wybor(f, { nazwa: 'last_period', etykieta: 'Ostatni okres przy końcu najmu', opcje: OSTATNI_OKRES })}`)}
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
      ${sekcja('Kaucja', `
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'deposit_gr', etykieta: 'Kwota kaucji (zł)', typ: 'kwota', podpowiedz: 'Puste = bez kaucji.' })}
          ${pole(f, { nazwa: 'deposit_on', etykieta: 'Data przyjęcia', typ: 'date', podpowiedz: 'Domyślnie data podpisania albo startu.' })}
        </div>
        ${opcje(f, { nazwa: 'deposit_method', legenda: 'Forma kaucji', opcje: FORMY })}
        <p class="podpowiedz">Kaucja nie jest przychodem (Z26).</p>`)}`,
  });
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
  if (nazwa === 'start_on' && w.start_on) {
    const dzienStary = poprzednie.start_on ? String(Number(poprzednie.start_on.slice(8))) : '';
    if (!poprzednie.billing_day || poprzednie.billing_day === dzienStary) w.billing_day = String(Number(w.start_on.slice(8)));
  }
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
  const wynik = walidujNajem(w, { indeksy: s.indeksy, ustawienia: ustawienia(s), plik: umowaPdf });
  if (maBledy(ctx, w, wynik.bledy)) return;
  const jednostka = s.indeksy.jednostki.get(w.unit_id);
  const klientId = w.client_id;

  await zapisz(ctx, async () => {
    ctx.scal(await ctx.db.zapiszPakiet(wynik.pakiet));
    let komunikat = `Dodano najem ${jednostka.code}`;
    if (umowaPdf) {
      try {
        const sciezka = await ctx.db.wgrajUmowe(s.uzytkownik.id, wynik.umowaId, umowaPdf);
        ctx.scal({ contracts: [await ctx.db.zmien('contracts', wynik.umowaId, { pdf_path: sciezka })] });
      } catch (e) {
        komunikat += `, ale PDF nie został wgrany (${e.message}). Dodaj go w sekcji Dokumenty`;
      }
    }
    ctx.toast(komunikat);
    ctx.nawiguj(`klienci/${encodeURIComponent(klientId)}`);
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
    end_on: k.najem.end_on ?? dzisiaj(), last_period: k.najem.last_period, zwrot_metoda: 'gotowka', zatrzymanie_powod: '',
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
  const f = stanFormularza(s, `najmy/${k.najem.id}/korekta`, () => ({ period_start: biezacy?.poczatek ?? '' }));
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
          ${wybor(f, { nazwa: 'period_start', etykieta: 'Okres', opcje: okresy, wymagane: true })}
          ${pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota korekty (zł)', typ: 'kwota', wymagane: true,
            podpowiedz: 'Ujemna = rabat lub umorzenie, np. -50. Dodatnia = dopłata. Należność nie może spaść poniżej 0 zł.' })}
          ${pole(f, { nazwa: 'reason', etykieta: 'Powód', wymagane: true, atrybuty: 'maxlength="200"' })}`,
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

const FORMULARZE = {
  stawka: { tytul: 'Zmiana stawki', render: formularzStawki },
  koniec: { tytul: 'Koniec najmu', render: formularzKonca },
  korekta: { tytul: 'Korekta należności', render: formularzKorekty },
};

/** Ekran nadrzędny dla „‹ wstecz” i podświetlonej zakładki. */
function nadrzedny(s) {
  const { parametr, zapytanie } = s.ui;
  if (parametr === 'podwyzka') return { href: '#/jednostki', tekst: 'Jednostki', zakladka: 'jednostki' };
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
