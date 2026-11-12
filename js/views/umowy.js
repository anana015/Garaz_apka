// Umowy do podpisania z wzorów Word (prośba 11.11.2026).
//  - Ustawienia → „Wzory umów”: lista, #/ustawienia/wzor/nowy (wgranie .docx), #/ustawienia/wzor/<id> (pola, pobranie, usunięcie),
//  - karta klienta → „Umowa do podpisania”: #/klienci/<id>/umowa[?najem=<id>] – wybór wzoru i najmów, podgląd pól,
//    pobranie wypełnionego .docx.
// Pliki wzorów leżą w buckecie „umowy” jako {user_id}/wzory/{id}.docx, lista w settings.contract_templates (migracja 011).

import { najemZakonczony } from '../dane.js';
import { formularz, maBledy, obszar, opcje, plik, pole, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { sciezkaWzoru } from '../kopia.js';
import { pobierzPlik, przycisk, pustyStan } from '../ui.js';
import {
  daneUmowy, dniWypowiedzenia, nazwaPlikuUmowy, POLA_OPCJONALNE, POLA_UMOWY, polaWzoru, PUSTE_MIEJSCE, wypelnijDocx,
} from '../umowy.js';
import { dzisiaj, esc, formatData, noweId, odmiana } from '../utils.js';
import { ustawienia } from './wspolne.js';
import { czytajKwh } from '../prad.js';

const MAX_WZORU = 10 * 1024 * 1024;
export const wzoryUmow = (s) => (Array.isArray(ustawienia(s).contract_templates) ? ustawienia(s).contract_templates : []);

const bezPolaczenia = (s) => s.podglad || s.offline || s.zKopii || !s.uzytkownik;

/** Dane wynajmującego (settings.landlords, migracja 015): [{ id, nazwa, dane }]. */
export const wynajmujacy = (s) => (Array.isArray(ustawienia(s).landlords) ? ustawienia(s).landlords : []);
const KLUCZ_WYNAJMUJACEGO = 'najem.umowa.wynajmujacy';
const ostatniWynajmujacy = () => { try { return localStorage.getItem(KLUCZ_WYNAJMUJACEGO) ?? ''; } catch { return ''; } };
const zapamietajWynajmujacego = (id) => { try { localStorage.setItem(KLUCZ_WYNAJMUJACEGO, id); } catch { /* bez pamięci */ } };

/** Lista pól do wstawienia we wzorze – w Ustawieniach i przy dodawaniu wzoru. */
export function listaPol() {
  return `<details class="historia-stawek"><summary>Pola do wstawienia we wzorze (${POLA_UMOWY.length})</summary>
    <p class="podpowiedz">Wpisz pole w Wordzie w podwójnych nawiasach klamrowych, np. <span class="mono">{{klient}}</span>.
      Brakująca dana (np. PESEL) zamieni się w kropki do wpisania ręcznie.</p>
    <div class="tabela-przewijana"><table class="tabela"><tbody>${POLA_UMOWY.map((p) => `<tr>
      <td class="mono">{{${esc(p.klucz)}}}</td><td>${esc(p.opis)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

// ---------------------------------------------------------------------
// Ustawienia → Wzory umów
// ---------------------------------------------------------------------

/** Treść karty „Wzory umów” w Ustawieniach. */
export function kartaWzorow(s) {
  const wzory = wzoryUmow(s);
  const lista = wzory.length
    ? `<ul class="lista">${wzory.map((w) => `<li><a class="wiersz" href="#/ustawienia/wzor/${encodeURIComponent(w.id)}">
        <div class="glowna"><strong>${esc(w.nazwa)}</strong>
          <span>${esc(w.plik ?? '')}${w.pola ? ` · ${odmiana(w.pola.length, ['pole', 'pola', 'pól'])}` : ''}${w.wgrano ? ` · wgrano ${formatData(w.wgrano.slice(0, 10))}` : ''}</span></div>
      </a></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak wzorów. Dodaj wzór umowy w Wordzie (.docx) z polami, np. {{klient}}, {{stawka}}.</p>';
  const wyn = wynajmujacy(s);
  return `${lista}
    <div class="pasek-akcji">${przycisk({ tekst: 'Dodaj wzór', href: '#/ustawienia/wzor/nowy', drugi: true, ikona: 'plus' })}</div>
    <h3 class="maly">Dane wynajmującego (pole {{dane_wynajmujacego}})</h3>
    ${wyn.length ? `<ul class="lista">${wyn.map((x) => `<li><a class="wiersz" href="#/ustawienia/wynajmujacy/${encodeURIComponent(x.id)}">
        <div class="glowna"><strong>${esc(x.nazwa)}</strong><span>${esc(String(x.dane ?? '').split('\n')[0])}</span></div></a></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak. Dodaj wersje danych wynajmującego – przy umowie wybierzesz jedną z nich.</p>'}
    <div class="pasek-akcji">${przycisk({ tekst: 'Dodaj dane wynajmującego', href: '#/ustawienia/wynajmujacy/nowy', drugi: true, ikona: 'plus' })}</div>
    ${listaPol()}`;
}

/** #/ustawienia/wynajmujacy/nowy | <id> – nazwa do wyboru i pełne dane (kilka linii). */
export function formularzWynajmujacego(s) {
  const x = wynajmujacy(s).find((w) => w.id === s.ui.akcja) ?? null;
  if (s.ui.akcja !== 'nowy' && !x) return pustyStan('Nie znaleziono danych wynajmującego.', [{ tekst: 'Ustawienia', href: '#/ustawienia' }]);
  const f = stanFormularza(s, `ustawienia/wynajmujacy/${s.ui.akcja}`, () => ({ nazwa: x?.nazwa ?? '', dane: x?.dane ?? '' }));
  return `${formularz(f, {
    nazwa: 'wynajmujacy',
    przycisk: x ? 'Zapisz' : 'Dodaj',
    anuluj: '#/ustawienia',
    tresc: `${pole(f, { nazwa: 'nazwa', etykieta: 'Nazwa do wyboru', wymagane: true, atrybuty: 'maxlength="40"',
      podpowiedz: 'Krótko, np. „Wynajmujący 1”, „Firma”, „Wspólnie”. Widać ją tylko w aplikacji.' })}
      ${obszar(f, { nazwa: 'dane', etykieta: 'Dane do umowy', wymagane: true, wiersze: 6, maks: 1000,
    podpowiedz: 'Dokładnie tak, jak mają być w umowie – imię i nazwisko / firma, adres, PESEL / NIP itd. Każda linia = nowa linia w umowie.' })}`,
  })}
  ${x ? `<section class="karta"><div class="pasek-akcji">${f.potwierdzUsuniecie
    ? `<span class="potwierdzenie">Usunąć „${esc(x.nazwa)}”?
        <button type="button" class="przycisk" data-akcja="usun-wynajmujacego-tak" data-id="${esc(x.id)}">Usuń</button>
        <button type="button" class="link-btn" data-akcja="usun-wzor-nie">Anuluj</button></span>`
    : '<button type="button" class="link-btn" data-akcja="usun-wzor">Usuń</button>'}</div></section>` : ''}`;
}

async function zapiszListeWynajmujacych(ctx, lista) {
  const s = ctx.state;
  try {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { landlords: lista }) });
  } catch (e) {
    throw /landlords/.test(e.message)
      ? new Error('W bazie brakuje miejsca na dane wynajmującego. Uruchom w Supabase plik supabase/migracje/015_wynajmujacy.sql.') : e;
  }
}

async function zapiszWynajmujacego(form, ctx) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const nazwa = String(w.nazwa ?? '').trim();
  const dane = String(w.dane ?? '').replace(/\r/g, '').trim();
  const id = s.ui.akcja === 'nowy' ? null : s.ui.akcja;
  const bledy = {};
  if (!nazwa) bledy.nazwa = 'Podaj nazwę.';
  else if (wynajmujacy(s).some((x) => x.id !== id && x.nazwa.toLowerCase() === nazwa.toLowerCase())) bledy.nazwa = 'Ta nazwa już jest.';
  if (!dane) bledy.dane = 'Wpisz dane wynajmującego.';
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const lista = id ? wynajmujacy(s).map((x) => (x.id === id ? { ...x, nazwa, dane } : x))
      : [...wynajmujacy(s), { id: noweId(), nazwa, dane }];
    await zapiszListeWynajmujacych(ctx, lista);
    ctx.toast(id ? `Zapisano „${nazwa}”` : `Dodano „${nazwa}”`);
    ctx.nawiguj('ustawienia');
  });
}

async function usunWynajmujacego(el, ctx) {
  const s = ctx.state;
  const x = wynajmujacy(s).find((w) => w.id === el.dataset.id);
  if (!x) return;
  if (bezPolaczenia(s)) { ctx.toast('Usuwanie wymaga połączenia z bazą.'); return; }
  try {
    await zapiszListeWynajmujacych(ctx, wynajmujacy(s).filter((w) => w.id !== x.id));
    ctx.toast(`Usunięto „${x.nazwa}”`);
    ctx.nawiguj('ustawienia');
  } catch (e) {
    ctx.toast(e.message);
  }
}

/** #/ustawienia/wzor/nowy */
export function formularzWzoru(s) {
  const f = stanFormularza(s, 'ustawienia/wzor/nowy', () => ({ nazwa: '' }));
  return `${formularz(f, {
    nazwa: 'wzor-umowy',
    przycisk: 'Wgraj wzór',
    anuluj: '#/ustawienia',
    tresc: `${pole(f, { nazwa: 'nazwa', etykieta: 'Nazwa wzoru', wymagane: true, atrybuty: 'maxlength="60"',
      podpowiedz: 'Np. „Umowa – garaż”, „Umowa – box”, „Umowa – firma”.' })}
      ${plik(f, { nazwa: 'plik', etykieta: 'Plik Word (.docx)', akceptuj: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    podpowiedz: 'Dokument z polami w podwójnych nawiasach klamrowych. Stary format .doc zapisz najpierw w Wordzie jako .docx.' })}`,
  })}
  <section class="karta">${listaPol()}</section>`;
}

/** #/ustawienia/wzor/<id> */
export function ekranWzoru(s) {
  const w = wzoryUmow(s).find((x) => x.id === s.ui.akcja);
  if (!w) return pustyStan('Nie znaleziono wzoru.', [{ tekst: 'Ustawienia', href: '#/ustawienia' }]);
  const f = stanFormularza(s, `ustawienia/wzor/${w.id}`, () => ({}));
  const znane = new Set(POLA_UMOWY.map((p) => p.klucz));
  const pola = w.pola ?? [];
  const nieznane = pola.filter((p) => !znane.has(p));
  return `<section class="karta">
      <dl class="opis-pol">
        <dt>Nazwa</dt><dd><strong>${esc(w.nazwa)}</strong></dd>
        <dt>Plik</dt><dd>${esc(w.plik ?? '')}</dd>
        ${w.wgrano ? `<dt>Wgrano</dt><dd>${formatData(w.wgrano.slice(0, 10))}</dd>` : ''}
        <dt>Pola we wzorze</dt><dd>${pola.length ? pola.map((p) => `<span class="chip${znane.has(p) ? '' : ' status zalega'}">${esc(p)}</span>`).join('')
    : '<span class="wyciszony">brak – aplikacja niczego nie podmieni</span>'}</dd>
      </dl>
      ${nieznane.length ? `<p class="baner ostrzezenie">Pola nieznane aplikacji zostaną w umowie bez zmian: ${nieznane.map(esc).join(', ')}.
        Sprawdź pisownię z listą pól poniżej.</p>` : ''}
      <div class="pasek-akcji">
        <button type="button" class="przycisk drugi" data-akcja="pobierz-wzor" data-wzor="${esc(w.id)}">Pobierz wzór</button>
        ${f.potwierdzUsuniecie
    ? `<span class="potwierdzenie">Usunąć wzór „${esc(w.nazwa)}”?
            <button type="button" class="przycisk" data-akcja="usun-wzor-tak" data-wzor="${esc(w.id)}">Usuń</button>
            <button type="button" class="link-btn" data-akcja="usun-wzor-nie">Anuluj</button></span>`
    : '<button type="button" class="link-btn" data-akcja="usun-wzor">Usuń wzór</button>'}
      </div>
      <p class="podpowiedz">Żeby zmienić wzór: pobierz go, popraw w Wordzie i dodaj jako nowy (stary usuń).</p>
    </section>
    <section class="karta">${listaPol()}</section>`;
}

async function zapiszWzor(form, ctx) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const f = s.ui.form;
  const plikWzoru = f.pliki?.plik;
  const bledy = {};
  const nazwa = String(w.nazwa ?? '').trim();
  if (!nazwa) bledy.nazwa = 'Podaj nazwę wzoru.';
  else if (wzoryUmow(s).some((x) => x.nazwa.toLowerCase() === nazwa.toLowerCase())) bledy.nazwa = 'Wzór o tej nazwie już jest.';
  if (!plikWzoru) bledy.plik = 'Wybierz plik .docx.';
  else if (!/\.docx$/i.test(plikWzoru.name)) bledy.plik = 'To musi być plik Word w formacie .docx.';
  else if (plikWzoru.size > MAX_WZORU) bledy.plik = 'Plik jest za duży (limit 10 MB).';
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const JSZip = await ctx.db.jszip();
    let pola;
    try {
      ({ pola } = await polaWzoru(JSZip, plikWzoru));
    } catch (e) {
      f.trwa = false;
      maBledy(ctx, w, { plik: e.message });
      return;
    }
    const id = noweId();
    await ctx.db.wgrajDoMagazynu(sciezkaWzoru(s.uzytkownik.id, id), plikWzoru,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const pozycja = { id, nazwa, plik: plikWzoru.name, wgrano: new Date().toISOString(), pola };
    try {
      ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { contract_templates: [...wzoryUmow(s), pozycja] }) });
    } catch (e) {
      await ctx.db.usunZMagazynu(sciezkaWzoru(s.uzytkownik.id, id)).catch(() => {});
      throw /contract_templates/.test(e.message)
        ? new Error('W bazie brakuje listy wzorów. Uruchom w Supabase plik supabase/migracje/011_wzory_umow.sql.') : e;
    }
    ctx.toast(pola.length ? `Dodano wzór „${nazwa}” (${odmiana(pola.length, ['pole', 'pola', 'pól'])})` : `Dodano wzór „${nazwa}” – nie ma w nim pól {{…}}`);
    ctx.nawiguj(`ustawienia/wzor/${id}`);
  });
}

async function pobierzWzor(el, ctx) {
  const s = ctx.state;
  const w = wzoryUmow(s).find((x) => x.id === el.dataset.wzor);
  if (!w) return;
  if (bezPolaczenia(s)) { ctx.toast('Pobranie wzoru wymaga połączenia z bazą.'); return; }
  try {
    pobierzPlik(w.plik || `${w.nazwa}.docx`, await ctx.db.pobierzZMagazynu(sciezkaWzoru(s.uzytkownik.id, w.id)),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (e) {
    ctx.toast(e.message);
  }
}

async function usunWzor(el, ctx) {
  const s = ctx.state;
  const w = wzoryUmow(s).find((x) => x.id === el.dataset.wzor);
  if (!w) return;
  if (bezPolaczenia(s)) { ctx.toast('Usuwanie wymaga połączenia z bazą.'); return; }
  try {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { contract_templates: wzoryUmow(s).filter((x) => x.id !== w.id) }) });
    await ctx.db.usunZMagazynu(sciezkaWzoru(s.uzytkownik.id, w.id)).catch(() => {});
    ctx.toast(`Usunięto wzór „${w.nazwa}”`);
    ctx.nawiguj('ustawienia');
  } catch (e) {
    ctx.toast(e.message);
  }
}

export const akcjeWzorow = {
  'pobierz-wzor': pobierzWzor,
  'usun-wzor'(_el, ctx) { if (ctx.state.ui.form) { ctx.state.ui.form.potwierdzUsuniecie = true; ctx.render(); } },
  'usun-wzor-nie'(_el, ctx) { if (ctx.state.ui.form) { ctx.state.ui.form.potwierdzUsuniecie = false; ctx.render(); } },
  'usun-wzor-tak': usunWzor,
  'usun-wynajmujacego-tak': usunWynajmujacego,
};
export const formularzeWzorow = { 'wzor-umowy': zapiszWzor, wynajmujacy: zapiszWynajmujacego };

// ---------------------------------------------------------------------
// Karta klienta → Umowa do podpisania
// ---------------------------------------------------------------------

/** Najmy, dla których można przygotować umowę: trwające i przyszłe (bez zakończonych). */
export function najmyDoUmowy(s, klientId, dzis = dzisiaj()) {
  return [...(s.indeksy.najmyKlienta.get(klientId) ?? [])].filter((n) => !najemZakonczony(n, dzis))
    .sort((a, b) => b.start_on.localeCompare(a.start_on));
}

/** Domyślnie zaznaczone najmy: wskazany w adresie albo najnowszy – razem z resztą jego umowy. */
function domyslneNajmy(najmy, wskazany) {
  const pierwszy = najmy.find((n) => n.id === wskazany) ?? najmy[0];
  return pierwszy ? najmy.filter((n) => n.contract_id === pierwszy.contract_id).map((n) => n.id) : [];
}

const lista = (x) => (x == null ? [] : [].concat(x));

/** Opcje daneUmowy z pól formularza umowy. */
const opcjeDanych = (s, w) => ({
  dataUmowy: w.data_umowy, numer: w.numer, licznik: w.licznik, okresDni: w.okres_dni,
  wynajmujacy: wynajmujacy(s).find((x) => x.id === w.wynajmujacy)?.dane ?? '',
});

/** #/klienci/<id>/umowa */
export function formularzUmowy(s, klient) {
  const dzis = dzisiaj();
  const wzory = wzoryUmow(s);
  const najmy = najmyDoUmowy(s, klient.id, dzis);
  const id = encodeURIComponent(klient.id);
  if (!najmy.length) {
    return pustyStan('Klient nie ma trwającego ani przyszłego najmu. Najpierw dodaj najem.',
      [{ tekst: '+ Nowy najem', href: `#/najmy/nowy?klient=${id}` }]);
  }
  if (!wzory.length) {
    return pustyStan('Nie ma jeszcze wzorów umów. Dodaj wzór w Wordzie (.docx) w Ustawieniach.',
      [{ tekst: 'Dodaj wzór', href: '#/ustawienia/wzor/nowy' }]);
  }
  const f = stanFormularza(s, `klienci/${klient.id}/umowa`, () => {
    const zaznaczone = domyslneNajmy(najmy, s.ui.zapytanie.najem);
    const umowa = s.indeksy.umowy.get(najmy.find((n) => n.id === zaznaczone[0])?.contract_id);
    const wyn = wynajmujacy(s);
    const ostatni = ostatniWynajmujacy();
    return { wzor: wzory.length === 1 ? wzory[0].id : '', najmy: zaznaczone,
      numer: umowa?.number ?? '', data_umowy: umowa?.signed_on ?? dzis,
      wynajmujacy: wyn.some((x) => x.id === ostatni) ? ostatni : wyn[0]?.id ?? '',
      okres_dni: String(dniWypowiedzenia(umowa?.notice_period) ?? 30), licznik: '' };
  });
  const zaznaczone = lista(f.wartosci.najmy);
  const wyn = wynajmujacy(s);
  const wartosci = daneUmowy(s, { ...opcjeDanych(s, f.wartosci), klientId: klient.id, najemIds: zaznaczone, dzis });
  const zPradem = zaznaczone.some((nid) => s.indeksy.jednostki.get(s.dane.rentals.find((n) => n.id === nid)?.unit_id)?.has_power);
  const wzor = wzory.find((w) => w.id === f.wartosci.wzor);
  // Podgląd: pola z wybranego wzoru (gdy znane), inaczej wszystkie.
  const klucze = wzor?.pola?.length ? wzor.pola : POLA_UMOWY.map((p) => p.klucz);
  const opisPola = new Map(POLA_UMOWY.map((p) => [p.klucz, p.opis]));
  const brakuje = klucze.filter((k) => opisPola.has(k) && !wartosci[k] && !POLA_OPCJONALNE.has(k));

  const wierszNajmu = (n) => {
    const j = s.indeksy.jednostki.get(n.unit_id);
    const u = s.indeksy.umowy.get(n.contract_id);
    return `<label class="opcja"><input type="checkbox" name="najmy" value="${esc(n.id)}" data-odswiez${zaznaczone.includes(n.id) ? ' checked' : ''}>
      <span><span class="mono">${esc(j?.code ?? '?')}</span> od ${formatData(n.start_on)}${u?.number ? ` · umowa ${esc(u.number)}` : ''}</span></label>`;
  };
  const podglad = `<div class="tabela-przewijana"><table class="tabela"><tbody>${klucze.map((k) => `<tr>
      <td class="mono">{{${esc(k)}}}</td>
      <td>${!opisPola.has(k) ? '<span class="status zalega">nieznane pole – zostanie bez zmian</span>'
    : wartosci[k] ? esc(wartosci[k]) : POLA_OPCJONALNE.has(k) ? '<span class="wyciszony">nie dotyczy – puste</span>'
      : `<span class="status czesciowo">brak – ${esc(PUSTE_MIEJSCE)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>`;

  return `${formularz(f, {
    nazwa: 'umowa',
    przycisk: 'Pobierz umowę (.docx)',
    anuluj: `#/klienci/${id}`,
    uwaga: '',
    tresc: `${opcje(f, { nazwa: 'wzor', legenda: 'Wzór umowy', opcje: wzory.map((w) => ({ wartosc: w.id, tekst: w.nazwa })), odswiez: true })}
      <fieldset class="pole opcje"><legend>Jednostki w umowie</legend>
        <div class="opcje-lista">${najmy.map(wierszNajmu).join('')}</div>
        ${f.bledy.najmy ? `<p class="blad">${esc(f.bledy.najmy)}</p>` : ''}</fieldset>
      ${wyn.length ? wybor(f, { nazwa: 'wynajmujacy', etykieta: 'Wynajmujący', odswiez: true,
    opcje: wyn.map((x) => ({ wartosc: x.id, tekst: x.nazwa })) })
    : `<p class="baner ostrzezenie"><span>Brak danych wynajmującego – w umowie będą kropki.
        <a href="#/ustawienia/wynajmujacy/nowy">Dodaj dane wynajmującego</a>.</span></p>`}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'numer', etykieta: 'Numer umowy', odswiez: true, atrybuty: 'maxlength="40"' })}
        ${pole(f, { nazwa: 'data_umowy', etykieta: 'Data zawarcia', typ: 'date', odswiez: true })}
      </div>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'okres_dni', etykieta: 'Okres wypowiedzenia (dni)', odswiez: true, atrybuty: 'inputmode="numeric" maxlength="4"' })}
        ${zPradem ? pole(f, { nazwa: 'licznik', etykieta: 'Stan licznika prądu (kWh)', odswiez: true, atrybuty: 'inputmode="decimal" maxlength="12"',
    podpowiedz: 'Na dzień wydania. Zapisze się też jako odczyt początkowy (rozliczenie prądu). Puste = kropki.' }) : ''}
      </div>
      <h3 class="maly">Dane, które trafią do umowy</h3>
      ${brakuje.length ? `<p class="baner ostrzezenie"><span>Brakuje: ${brakuje.map((k) => esc(opisPola.get(k))).join(', ')}.
        W umowie będą kropki do wpisania ręcznie – albo <a href="#/klienci/${id}/edycja">uzupełnij dane klienta</a>.</span></p>` : ''}
      ${podglad}
      <p class="podpowiedz">Plik pobierze się na to urządzenie – otwórz go w Wordzie, sprawdź i wydrukuj. Podpisaną umowę
        możesz potem dodać jako PDF w karcie „Dokumenty”.</p>`,
  })}`;
}

async function pobierzUmowe(form, ctx) {
  const s = ctx.state;
  const klient = s.indeksy.klienci.get(s.ui.parametr);
  if (!klient) return;
  const w = wartosciFormularza(form);
  const wzor = wzoryUmow(s).find((x) => x.id === w.wzor);
  const najmy = lista(w.najmy);
  const bledy = {};
  if (!wzor) bledy.wzor = 'Wybierz wzór umowy.';
  if (!najmy.length) bledy.najmy = 'Zaznacz co najmniej jedną jednostkę.';
  if (maBledy(ctx, w, bledy)) return;
  if (bezPolaczenia(s)) {
    ctx.state.ui.form.blad = 'Pobranie wzoru wymaga połączenia z bazą.';
    ctx.render();
    return;
  }
  const f = s.ui.form;
  f.trwa = true;
  ctx.render();
  try {
    const dzis = dzisiaj();
    const wartosci = daneUmowy(s, { ...opcjeDanych(s, w), klientId: klient.id, najemIds: najmy, dzis });
    if (w.wynajmujacy) zapamietajWynajmujacego(w.wynajmujacy);
    const JSZip = await ctx.db.jszip();
    const plikWzoru = await ctx.db.pobierzZMagazynu(sciezkaWzoru(s.uzytkownik.id, wzor.id));
    const wynik = await wypelnijDocx(JSZip, plikWzoru, wartosci);
    pobierzPlik(nazwaPlikuUmowy(wartosci, dzis), wynik.plik,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    ctx.toast(wynik.puste.length ? `Umowa gotowa – ${wynik.puste.length} pól do wpisania ręcznie` : 'Umowa gotowa do wydruku');
    await zapiszLicznikStartowy(ctx, najmy, w.licznik);
  } catch (e) {
    f.blad = e.message;
  } finally {
    f.trwa = false;
    ctx.render();
  }
}

/**
 * Stan licznika z umowy → odczyt początkowy (power_readings, migracja 017) dla jednostki z prądem, której najem nie ma
 * jeszcze odczytu. Tylko gdy w umowie jest jedna jednostka z prądem; błąd zapisu nie przerywa pobrania umowy.
 */
async function zapiszLicznikStartowy(ctx, najemIds, licznik) {
  const s = ctx.state;
  const kwh = czytajKwh(licznik);
  if (kwh == null) return;
  const zPradem = najemIds.map((id) => s.dane.rentals.find((n) => n.id === id))
    .filter((n) => n && s.indeksy.jednostki.get(n.unit_id)?.has_power);
  if (zPradem.length !== 1) return;
  const n = zPradem[0];
  if ((s.dane.power_readings ?? []).some((o) => o.rental_id === n.id)) return;
  try {
    const odczyt = await ctx.db.wstaw('power_readings', { unit_id: n.unit_id, rental_id: n.id, read_on: n.start_on, kwh, amount_gr: null });
    ctx.scal({ power_readings: [odczyt] });
  } catch { /* bez migracji 017 – stan licznika zostaje tylko w umowie */ }
}

export const formularzeUmowy = { umowa: pobierzUmowe };
