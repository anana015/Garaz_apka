// Import wyciągu (8.3): wybór konta i pliku → podgląd z przypisaniem klientów (7.3) → zapis → wynik.
// Plik czyta przeglądarka; wpływy → payments (jednym pakietem), wypływy → koszty (etap 2, expenses) z regułami
// „fraza → kategoria”; wypływ, który nie jest kosztem, zapisuje się jako „pominięty”, żeby nie wracał.
// Nieznany bank: ekran ręcznego mapowania kolumn (7.2), mapowanie zapamiętane przy koncie (csv_mapping, migracja 005).

import {
  kluczeDuplikatow, kolumnyPliku, mapowaniePasuje, odczytajWyciag, odczytajZMapowaniem, OBSLUGIWANE, POLA_MAPOWANIA,
  zbudujMapowanie, zgadnijMapowanie,
} from '../banki.js';
import { dekoduj } from '../csv.js';
import { najemZakonczony, ostatniaWplataNaKoncie, wplataReczna } from '../dane.js';
import { formularz, plik, przelacznik, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { indeksPlatnikow, rozpoznaj } from '../rozpoznanie.js';
import { przycisk, pustyStan } from '../ui.js';
import {
  esc, dzisiaj, formatData, formatZl, formatRachunek, dataZeZnacznika, noweId, normalizujTekst, odmiana, porownajKody,
  roznicaDni,
} from '../utils.js';
import { BANKI } from '../walidacja.js';
import { dopasujRegule, frazaZKontrahenta, KATEGORIE, nazwaKategorii, POMINIETY } from '../koszty.js';
import { TYPY_JEDNOSTEK } from '../config.js';

const LICZBA_OSTATNICH = 10;
const ZNACZNIK = {
  rachunek: { klasa: 'ok', tekst: 'rachunek' },
  nazwa: { klasa: 'czesciowo', tekst: 'nazwa – sprawdź' },
  brak: { klasa: 'wylaczona', tekst: 'brak dopasowania' },
};

/** Przelewy wpisane ręcznie łączymy z wierszem wyciągu: to samo konto i kwota, data do 5 dni różnicy. */
const DNI_LACZENIA = 5;

// ---------------------------------------------------------------------
// Przygotowanie podglądu (bez DOM)
// ---------------------------------------------------------------------

function przygotuj(s, odczyt, kontoId, nazwaPliku, zrodlo = null) {
  const istniejace = new Set(s.dane.payments.map((p) => p.dedup_key).filter(Boolean));
  const klucze = kluczeDuplikatow(kontoId, odczyt.wiersze);
  const indeks = indeksPlatnikow(s.dane);
  const l = { razem: odczyt.wiersze.length, wyplywy: 0, duplikaty: 0, bledy: 0, polaczone: 0 };
  const nowe = [];
  const reczne = s.dane.payments.filter((p) => p.method === 'przelew' && wplataReczna(p) && p.bank_account_id === kontoId);
  const uzyte = new Set();
  const bledne = [];
  const istniejaceKoszty = new Set((s.dane.expenses ?? []).map((e) => e.dedup_key).filter(Boolean));
  const wyplywy = [];
  odczyt.wiersze.forEach((w, i) => {
    if (w.blad) { l.bledy += 1; bledne.push(w); return; }
    if (w.kwotaGr <= 0) {
      if (w.kwotaGr < 0 && istniejaceKoszty.has(klucze[i])) { l.duplikaty += 1; return; }
      l.wyplywy += 1;
      if (w.kwotaGr === 0) return;
      const r = dopasujRegule(w, s.dane.cost_rules ?? []);
      wyplywy.push({ ...w, klucz: klucze[i], regula: r, kategoria: r?.category ?? POMINIETY, jednostka: r?.unit_id ?? '',
        fraza: frazaZKontrahenta(w.kontrahent) });
      return;
    }
    if (istniejace.has(klucze[i])) { l.duplikaty += 1; return; }
    const reczna = reczne.find((p) => !uzyte.has(p.id) && p.amount_gr === w.kwotaGr
      && Math.abs(roznicaDni(p.booked_on, w.data)) <= DNI_LACZENIA);
    if (reczna) {
      uzyte.add(reczna.id);
      l.polaczone += 1;
      const r = rozpoznaj(w, indeks);
      nowe.push({ ...w, klucz: klucze[i], ...r, reczna, klientId: reczna.client_id ?? r.klientId,
        metoda: reczna.client_id ? 'reczne' : r.metoda, potwierdzone: Boolean(reczna.client_id) || r.potwierdzone });
      return;
    }
    nowe.push({ ...w, klucz: klucze[i], ...rozpoznaj(w, indeks) });
  });
  // zrodlo: tekst pliku przy mapowaniu ręcznym – pozwala wrócić do wyboru kolumn („Zmień kolumny”).
  return { kontoId, nazwaPliku, bank: odczyt.bank, rachunek: odczyt.rachunek, nowe, wyplywy, bledne, l, reczne: Boolean(odczyt.reczne), zrodlo };
}

// ---------------------------------------------------------------------
// Ekran 1: konto i plik
// ---------------------------------------------------------------------

function wyborPliku(s, konta) {
  const f = stanFormularza(s, 'import/plik', () => ({ konto: konta[0]?.id ?? '' }));
  return formularz(f, {
    nazwa: 'wyciag',
    przycisk: 'Wczytaj',
    uwaga: `Rozpoznaję wyciągi: ${Object.values(OBSLUGIWANE).join(', ')}. Z innego banku (np. PKO BP, Alior) wskażesz kolumny raz – zapamiętam je przy koncie.`,
    tresc: `<h2>Wczytaj wyciąg CSV</h2>
      ${wybor(f, { nazwa: 'konto', etykieta: 'Konto', opcje: konta.map((k) => ({ wartosc: k.id, tekst: k.name })) })}
      ${plik(f, { nazwa: 'plik', etykieta: 'Plik z banku', akceptuj: '.csv,text/csv',
        podpowiedz: 'Plik zostaje na tym urządzeniu – do bazy trafiają tylko wpływy.' })}`,
  });
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


// ---------------------------------------------------------------------
// Ekran 1b: ręczne mapowanie kolumn (7.2) – plik z banku bez gotowego profilu
// ---------------------------------------------------------------------

const LICZBA_PODGLADU = 5;

/** Wybrane kolumny z wartości formularza: { data: 'NAGLOWEK', … }. */
const wybraneKolumny = (w) => Object.fromEntries(POLA_MAPOWANIA.map((p) => [p.id, w[`k_${p.id}`] || '']));

function ekranMapowania(s, m) {
  const konto = s.indeksy.konta.get(m.kontoId);
  const f = stanFormularza(s, 'import/mapowanie', () => {
    const zgadniete = m.zapamietane?.kolumny ?? zgadnijMapowanie(m.kolumny.kolumny);
    return { ...Object.fromEntries(POLA_MAPOWANIA.map((p) => [`k_${p.id}`, zgadniete[p.id] ?? ''])), zapamietaj: 'on' };
  });
  const przyklad = (i) => m.kolumny.przyklady.map((w) => w[i]).find((x) => x) ?? '';
  const opcje = m.kolumny.kolumny.map((k, i) => {
    const pr = przyklad(i);
    return { wartosc: normalizujTekst(k), tekst: `${k || `kolumna ${i + 1}`}${pr ? ` – np. „${pr.slice(0, 30)}”` : ''}` };
  });
  const pola = POLA_MAPOWANIA.map((p) => wybor(f, { nazwa: `k_${p.id}`, etykieta: p.tekst, opcje, wymagane: p.wymagane,
    pusta: p.wymagane ? 'Wybierz kolumnę…' : '— brak w pliku —', odswiez: true })).join('');

  // Podgląd: pierwsze wiersze odczytane według bieżącego wyboru.
  const wybrane = wybraneKolumny(f.wartosci);
  let podgladHtml = '<p class="podpowiedz">Wybierz kolumny daty i kwoty, a pokażę, jak odczytam pierwsze wiersze.</p>';
  if (wybrane.data && wybrane.kwota) {
    const o = odczytajZMapowaniem(m.tekst, { kolumny: wybrane });
    const wiersze = o.wiersze.slice(0, LICZBA_PODGLADU);
    podgladHtml = `<div class="tabela-przewijana"><table class="tabela"><thead><tr><th scope="col">Data</th>
      <th scope="col" class="kwota">Kwota</th><th scope="col">Nadawca</th><th scope="col">Tytuł</th><th scope="col">Uwagi</th></tr></thead>
      <tbody>${wiersze.map((w) => `<tr><td>${w.data ? formatData(w.data) : '—'}</td>
        <td class="kwota">${w.kwotaGr != null ? formatZl(w.kwotaGr) : '—'}</td><td>${esc(w.kontrahent || '—')}</td>
        <td>${esc((w.tytul || '').slice(0, 60))}</td>
        <td>${w.blad ? `<span class="status zalega">${esc(w.blad)}</span>` : w.kwotaGr <= 0
    ? '<span class="wyciszony">wypływ – koszt</span>' : w.rachunekNadawcy ? '<span class="status ok">rachunek</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="podpowiedz">W pliku ${odmiana(o.wiersze.length, ['wiersz', 'wiersze', 'wierszy'])}; czytelnych:
        ${o.wiersze.filter((w) => !w.blad).length}.</p>`;
  }
  return formularz(f, {
    nazwa: 'wyciag-mapowanie',
    przycisk: 'Dalej – podgląd wpłat',
    uwaga: '',
    tresc: `<h2>Wskaż kolumny wyciągu</h2>
      <p class="podpowiedz">Nie rozpoznaję pliku <strong>${esc(m.nazwaPliku)}</strong>. Wskaż, w których kolumnach są dane –
        podpowiedziałam po nazwach nagłówków. Konto: <strong>${esc(konto?.name ?? '?')}</strong>.</p>
      ${pola}
      <h3 class="maly">Podgląd</h3>
      ${podgladHtml}
      ${przelacznik(f, { nazwa: 'zapamietaj', etykieta: `Zapamiętaj kolumny dla konta ${konto?.name ?? ''}`,
    podpowiedz: 'Kolejne wyciągi z tymi samymi nagłówkami wczytają się bez pytania.' })}
      <p><button type="button" class="link-btn" data-akcja="anuluj-import">Anuluj</button></p>`,
  });
}

// ---------------------------------------------------------------------
// Ekran 2: podgląd (7.3)
// ---------------------------------------------------------------------

/** Lista klientów do wyboru – raz na podgląd (ten sam HTML w każdym wierszu, różni się tylko zaznaczenie). */
function opcjeKlientow(s) {
  const dzien = dzisiaj();
  return s.dane.clients.filter((k) => !k.archived).map((k) => {
    const kody = (s.indeksy.najmyKlienta.get(k.id) ?? []).filter((n) => !najemZakonczony(n, dzien))
      .map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
    return { id: k.id, tekst: kody.length ? `${k.name} (${kody.join(', ')})` : k.name };
  }).sort((a, b) => a.tekst.localeCompare(b.tekst, 'pl'));
}

function kafelek(liczba, tekst, opis = '') {
  return `<div class="kafelek"><span class="etykieta">${esc(tekst)}</span><span class="wartosc">${liczba}</span>${
    opis ? `<span class="opis">${esc(opis)}</span>` : ''}</div>`;
}

function podglad(s, p) {
  const f = stanFormularza(s, 'import/zapis', () => ({}));
  const konto = s.indeksy.konta.get(p.kontoId);
  const przypisane = p.nowe.filter((w) => w.klientId);
  const zRachunku = przypisane.filter((w) => w.metoda === 'rachunek').length;
  const klienci = opcjeKlientow(s);
  const opcje = (wybrany) => `<option value="">— do przypisania —</option>${klienci.map((k) =>
    `<option value="${esc(k.id)}"${k.id === wybrany ? ' selected' : ''}>${esc(k.tekst)}</option>`).join('')}`;

  const wiersze = p.nowe.map((w, i) => {
    const z = w.reczna ? { klasa: 'ok', tekst: `wpisana ręcznie ${formatData(w.reczna.booked_on)} – połączę` }
      : ZNACZNIK[w.klientId ? w.metoda : 'brak'];
    return `<li class="wiersz-importu"><div class="wiersz">
      <div class="glowna"><strong>${esc(w.kontrahent || '—')}</strong>
        <span>${formatData(w.data)}${w.tytul ? ` · ${esc(w.tytul)}` : ''}</span>
        ${w.rachunekNadawcy ? `<span class="maly wyciszony mono">${esc(formatRachunek(w.rachunekNadawcy))}</span>` : ''}</div>
      <div class="prawa"><div class="kwota">${formatZl(w.kwotaGr)}</div>
        <div class="maly"><span class="status ${z.klasa}">${esc(z.tekst)}</span></div></div></div>
      <div class="pola-w-rzedzie">
        <div class="pole"><label for="imp-k-${i}">Klient</label>
          <select id="imp-k-${i}" name="klient-${i}">${opcje(w.klientId)}</select></div>
        <div class="pole pole-wyboru"><input id="imp-p-${i}" name="pomin-${i}" type="checkbox">
          <label for="imp-p-${i}">Pomiń (nie czynsz)</label></div>
      </div></li>`;
  }).join('');

  const opcjeKat = (wybrana) => [...Object.entries(KATEGORIE), [POMINIETY, nazwaKategorii(POMINIETY)]].map(([k, t]) =>
    `<option value="${k}"${k === wybrana ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const jednostki = s.dane.units.filter((j) => !j.archived)
    .sort((a, b) => Object.keys(TYPY_JEDNOSTEK).indexOf(a.type) - Object.keys(TYPY_JEDNOSTEK).indexOf(b.type) || porownajKody(a.code, b.code));
  const opcjeJed = (wybrana) => `<option value="">— wspólny —</option>${jednostki.map((j) =>
    `<option value="${esc(j.id)}"${j.id === wybrana ? ' selected' : ''}>${esc(j.code)}</option>`).join('')}`;
  const wierszeKosztow = (p.wyplywy ?? []).map((w, i) => `<li class="wiersz-importu"><div class="wiersz">
      <div class="glowna"><strong>${esc(w.kontrahent || '—')}</strong>
        <span>${formatData(w.data)}${w.tytul ? ` · ${esc(w.tytul)}` : ''}</span></div>
      <div class="prawa"><div class="kwota">${formatZl(-w.kwotaGr)}</div>
        <div class="maly"><span class="status ${w.regula ? 'ok' : 'wylaczona'}">${w.regula ? `reguła ${esc(w.regula.phrase)}` : 'bez reguły'}</span></div></div></div>
      <div class="pola-w-rzedzie">
        <div class="pole"><label for="imp-kat-${i}">Kategoria</label><select id="imp-kat-${i}" name="kat-${i}">${opcjeKat(w.kategoria)}</select></div>
        <div class="pole"><label for="imp-jed-${i}">Jednostka</label><select id="imp-jed-${i}" name="jed-${i}">${opcjeJed(w.jednostka)}</select></div>
      </div>
      ${!w.regula && w.fraza ? `<div class="pole pole-wyboru"><input id="imp-reg-${i}" name="reg-${i}" type="checkbox">
        <label for="imp-reg-${i}">Zapamiętaj regułę: „${esc(w.fraza)}” → wybrana kategoria</label></div>` : ''}</li>`).join('');
  const sekcjaKosztow = wierszeKosztow ? `<h2 class="naglowek-sekcji">Wypływy – koszty (${p.wyplywy.length})</h2>
    <p class="podpowiedz">Wybierz kategorię albo „Pominięty (nie koszt)” – np. przelew własny, wypłata, ryczałt. Wszystkie wypływy
      zapiszą się, więc przy kolejnym imporcie tego pliku nie wrócą.</p>
    <ul class="lista">${wierszeKosztow}</ul>` : '';

  const bledne = p.bledne.length ? `<section class="karta"><h2>Wiersze z błędem (nie zapiszą się)</h2>
    <ul class="lista">${p.bledne.map((w) => `<li><div class="wiersz wyciszony"><div class="glowna">
      <strong>Wiersz ${w.nr}: ${esc(w.kontrahent || '—')}</strong><span>${esc(w.blad)}</span></div></div></li>`).join('')}</ul></section>` : '';

  const naglowek = `<section class="karta">
    <h2>${esc(p.nazwaPliku)}</h2>
    <p class="podpowiedz">${p.reczne ? 'kolumny wskazane ręcznie' : esc(OBSLUGIWANE[p.bank] ?? '')} · konto <strong>${
  esc(konto?.name ?? '?')}</strong>${p.rachunek ? ` · <span class="mono">${esc(formatRachunek(p.rachunek))}</span>` : ''}${
  p.zrodlo ? ' · <button type="button" class="link-btn" data-akcja="zmien-kolumny">Zmień kolumny</button>' : ''}</p>
    <div class="kafelki">
      ${kafelek(p.nowe.length, 'nowe wpłaty')}
      ${kafelek(przypisane.length, 'przypisane automatycznie', `rachunek ${zRachunku} · nazwa ${przypisane.length - zRachunku}`)}
      ${kafelek(p.nowe.length - przypisane.length, 'do przypisania')}
      ${p.wyplywy?.length ? kafelek(p.wyplywy.length, 'wypływy', `z regułą ${p.wyplywy.filter((w) => w.regula).length}`) : ''}
      ${kafelek(p.l.duplikaty, 'duplikaty', `${p.l.wyplywy - (p.wyplywy?.length ?? 0) ? `zerowe ${p.l.wyplywy - (p.wyplywy?.length ?? 0)}` : ''}${
  p.l.polaczone ? ` · połączone z wpisanymi ręcznie ${p.l.polaczone}` : ''}`)}
    </div></section>`;

  if (!p.nowe.length && !p.wyplywy?.length) {
    const tekst = p.l.duplikaty ? 'Wszystkie wpłaty i wypływy z tego pliku są już zapisane.' : 'Brak wpłat ani kosztów do zapisania.';
    return `${naglowek}${pustyStan(tekst, [{ tekst: 'Wczytaj inny plik', akcja: 'anuluj-import' }])}${bledne}`;
  }

  return `${naglowek}
    ${formularz(f, {
    nazwa: 'wyciag-zapis',
    uwaga: 'Sprawdź klientów oznaczonych „nazwa – sprawdź”. Wpłaty bez klienta trafią do „Do przypisania”.',
    przycisk: `Zapisz ${[p.nowe.length ? odmiana(p.nowe.length, ['wpłatę', 'wpłaty', 'wpłat']) : '',
      p.wyplywy?.length ? odmiana(p.wyplywy.length, ['wypływ', 'wypływy', 'wypływów']) : ''].filter(Boolean).join(' i ')}`,
    tresc: `${p.nowe.length ? `<h2 class="naglowek-sekcji">Wpływy – wpłaty (${p.nowe.length})</h2><ul class="lista">${wiersze}</ul>` : ''}${sekcjaKosztow}`,
  })}
    <p><button type="button" class="link-btn" data-akcja="anuluj-import">Anuluj</button></p>
    ${bledne}`;
}

// ---------------------------------------------------------------------
// Ekran 3: wynik
// ---------------------------------------------------------------------

function wynik(w) {
  return `<section class="karta"><h2>Zapisano</h2>
    <p>Zapisano <strong>${odmiana(w.zapisane, ['wpłatę', 'wpłaty', 'wpłat'])}</strong>,
      ${w.przypisane} przypisano do klientów, <strong>${w.doPrzypisania}</strong> czeka na przypisanie${
  w.pominiete ? `, ${w.pominiete} pominięto` : ''}.${w.koszty || w.kosztyPominiete ? ` Koszty: <strong>${w.koszty}</strong>${
  w.kosztyPominiete ? `, wypływy pominięte: ${w.kosztyPominiete}` : ''}.` : ''}</p>
    ${w.ostrzezenie ? `<p class="baner ostrzezenie">${esc(w.ostrzezenie)}</p>` : ''}
    <div class="pasek-akcji">
      ${w.doPrzypisania ? przycisk({ tekst: 'Pokaż do przypisania', akcja: 'do-przypisania' }) : ''}
      ${przycisk({ tekst: 'Wczytaj kolejny wyciąg', akcja: 'anuluj-import', drugi: true })}
      ${w.koszty ? przycisk({ tekst: 'Pokaż koszty', href: '#/koszty', drugi: true }) : ''}
      ${przycisk({ tekst: 'Pokaż pulpit', href: '#/pulpit', drugi: true })}
    </div></section>`;
}

// ---------------------------------------------------------------------

export default {
  tytul: () => 'Import wyciągu',
  wstecz: () => ({ href: '#/wplaty', tekst: 'Wpłaty' }),

  render(s) {
    const konta = s.dane.bank_accounts.filter((k) => !k.archived);
    if (!konta.length) {
      return pustyStan('Najpierw dodaj konto bankowe, z którego pochodzi wyciąg.', [
        { tekst: 'Dodaj konto', href: '#/ustawienia/konto/nowe' }]);
    }
    if (s.ui.wyciag?.wynik) return wynik(s.ui.wyciag.wynik);
    if (s.ui.wyciag?.podglad) return podglad(s, s.ui.wyciag.podglad);
    if (s.ui.wyciag?.mapowanie) return ekranMapowania(s, s.ui.wyciag.mapowanie);
    return `<div class="siatka">${wyborPliku(s, konta)}<div class="stos">${ostatnieImporty(s)}</div></div>`;
  },

  akcje: {
    'anuluj-import'(_el, ctx) {
      ctx.state.ui.wyciag = null;
      ctx.state.ui.form = null;
      ctx.render();
    },
    /** Powrót z podglądu do wyboru kolumn (mapowanie ręczne). */
    'zmien-kolumny'(_el, ctx) {
      const z = ctx.state.ui.wyciag?.podglad?.zrodlo;
      if (!z) return;
      ctx.state.ui.wyciag = { mapowanie: z };
      ctx.state.ui.form = null;
      ctx.render();
    },
    'do-przypisania'(_el, ctx) {
      ctx.state.ui.wyciag = null;
      ctx.state.ui.filtry.wplaty = 'do-przypisania';
      ctx.nawiguj('wplaty');
    },
  },

  formularze: {
    /** Odczyt pliku → podgląd. */
    async wyciag(form, ctx) {
      const s = ctx.state;
      const f = s.ui.form;
      const plikWyciagu = f?.pliki?.plik;
      f.wartosci = { konto: form.elements.konto?.value ?? '' };
      if (!plikWyciagu) {
        f.bledy = { plik: 'Wybierz plik CSV z banku.' };
        ctx.render();
        return;
      }
      const tekst = dekoduj(await plikWyciagu.arrayBuffer());
      let odczyt = odczytajWyciag(tekst);
      let kontoId = f.wartosci.konto;
      let zrodlo = null;
      if (odczyt.nierozpoznany) {
        // Nieznany bank: zapamiętane mapowanie (najpierw wybranego konta, potem innych) albo ekran wyboru kolumn.
        const aktywne = s.dane.bank_accounts.filter((k) => !k.archived);
        const wybrane = s.indeksy.konta.get(kontoId);
        const zMapowaniem = [wybrane, ...aktywne].find((k) => k?.csv_mapping && mapowaniePasuje(k.csv_mapping, tekst));
        const kolumny = kolumnyPliku(tekst);
        if (!kolumny) {
          f.bledy = { plik: 'Ten plik nie wygląda na wyciąg CSV.' };
          ctx.render();
          return;
        }
        zrodlo = { tekst, kontoId, nazwaPliku: plikWyciagu.name, kolumny, zapamietane: wybrane?.csv_mapping ?? null };
        if (!zMapowaniem) {
          s.ui.wyciag = { mapowanie: zrodlo };
          s.ui.form = null;
          ctx.render();
          globalThis.scrollTo?.(0, 0);
          return;
        }
        if (zMapowaniem.id !== kontoId) ctx.toast(`Te kolumny są zapamiętane dla konta ${zMapowaniem.name} – przełączyłam.`);
        kontoId = zMapowaniem.id;
        zrodlo = { ...zrodlo, kontoId, zapamietane: zMapowaniem.csv_mapping };
        odczyt = odczytajZMapowaniem(tekst, zMapowaniem.csv_mapping);
      }
      if (odczyt.blad) {
        f.bledy = { plik: odczyt.blad };
        ctx.render();
        return;
      }
      // Konto z numeru rachunku w pliku (7.2); gdy inne niż wybrane – przełączamy i mówimy o tym.
      const pasujace = odczyt.rachunek && s.dane.bank_accounts.find((k) => k.iban === odczyt.rachunek && !k.archived);
      if (pasujace && pasujace.id !== kontoId) {
        ctx.toast(`Ten wyciąg jest z konta ${pasujace.name} – przełączyłam.`);
        kontoId = pasujace.id;
      }
      const konto = s.indeksy.konta.get(kontoId);
      if (konto && odczyt.bank && konto.bank !== odczyt.bank && konto.bank !== 'inny') {
        f.bledy = { konto: `Ten plik jest z banku ${OBSLUGIWANE[odczyt.bank]}, a wybrane konto to ${BANKI[konto.bank] ?? konto.bank}.` };
        ctx.render();
        return;
      }
      s.ui.wyciag = { podglad: przygotuj(s, odczyt, kontoId, plikWyciagu.name, zrodlo) };
      s.ui.form = null;
      ctx.render();
      globalThis.scrollTo?.(0, 0);
    },

    /** Wybrane kolumny → (opcjonalnie) zapamiętanie przy koncie → podgląd wpłat. */
    async 'wyciag-mapowanie'(form, ctx) {
      const s = ctx.state;
      const m = s.ui.wyciag?.mapowanie;
      const f = s.ui.form;
      if (!m || !f) return;
      const w = wartosciFormularza(form);
      const kolumny = wybraneKolumny(w);
      const bledy = {};
      for (const p of POLA_MAPOWANIA) if (p.wymagane && !kolumny[p.id]) bledy[`k_${p.id}`] = 'Wskaż kolumnę.';
      const odczyt = Object.keys(bledy).length ? null : odczytajZMapowaniem(m.tekst, { kolumny });
      if (odczyt && !odczyt.wiersze.some((x) => !x.blad)) {
        bledy.k_data = 'Żaden wiersz się nie odczytał – sprawdź kolumny daty i kwoty.';
      }
      Object.assign(f, { wartosci: w, bledy });
      if (Object.keys(bledy).length) {
        ctx.render();
        document.querySelector('#widok [aria-invalid="true"]')?.focus();
        return;
      }
      if (w.zapamietaj === 'on' && !s.podglad && !s.offline && !s.zKopii) {
        try {
          const konto = await ctx.db.zmien('bank_accounts', m.kontoId, { csv_mapping: zbudujMapowanie(m.kolumny.kolumny, kolumny) });
          ctx.scal({ bank_accounts: [konto] });
        } catch (e) {
          ctx.toast(/csv_mapping/.test(e.message)
            ? 'Nie zapamiętałam kolumn – uruchom w Supabase migrację 005_mapowanie_csv.sql.'
            : `Nie zapamiętałam kolumn: ${e.message}`);
        }
      }
      s.ui.wyciag = { podglad: przygotuj(s, odczyt, m.kontoId, m.nazwaPliku, { ...m, zapamietane: { kolumny } }) };
      s.ui.form = null;
      ctx.render();
      globalThis.scrollTo?.(0, 0);
    },

    /** Zapis: wiersz imports, potem wszystkie wpłaty jednym pakietem (wszystko albo nic). */
    async 'wyciag-zapis'(form, ctx) {
      const s = ctx.state;
      const p = s.ui.wyciag?.podglad;
      if (!p) return;
      const fd = new FormData(form);
      const importId = noweId();
      const wplaty = p.nowe.map((w, i) => {
        const pomin = fd.get(`pomin-${i}`) === 'on';
        const klient = String(fd.get(`klient-${i}`) ?? '') || null;
        const zmieniony = klient !== w.klientId;
        return {
          id: w.reczna?.id ?? noweId(), booked_on: w.data, amount_gr: w.kwotaGr, kind: pomin ? 'pominieta' : (w.reczna?.kind ?? 'czynsz'),
          method: 'przelew', bank_account_id: p.kontoId, counterparty: w.kontrahent || null, title: w.tytul || null,
          payer_account: w.rachunekNadawcy, client_id: klient,
          match_method: klient ? (zmieniony ? 'reczne' : w.metoda) : null,
          match_confirmed: Boolean(klient) && (zmieniony || w.potwierdzone),
          dedup_key: w.klucz, import_id: importId,
        };
      });

      const koszty = (p.wyplywy ?? []).map((w, i) => {
        const kat = String(fd.get(`kat-${i}`) ?? POMINIETY);
        return {
          id: noweId(), spent_on: w.data, amount_gr: -w.kwotaGr,
          category: KATEGORIE[kat] || kat === POMINIETY ? kat : POMINIETY,
          unit_id: String(fd.get(`jed-${i}`) ?? '') || null, source: 'import', bank_account_id: p.kontoId,
          counterparty: w.kontrahent || null, title: w.tytul || null, dedup_key: w.klucz, import_id: importId,
        };
      });
      const reguly = [];
      (p.wyplywy ?? []).forEach((w, i) => {
        if (fd.get(`reg-${i}`) !== 'on' || !w.fraza || reguly.some((r) => r.phrase === w.fraza)) return;
        reguly.push({ phrase: w.fraza, category: koszty[i].category, unit_id: koszty[i].unit_id });
      });

      await zapisz(ctx, async () => {
        const imp = await ctx.db.wstaw('imports', {
          id: importId, bank_account_id: p.kontoId, file_name: p.nazwaPliku, rows_total: p.l.razem,
          rows_added: wplaty.length, rows_duplicate: p.l.duplikaty, rows_outflow: p.l.wyplywy, rows_error: p.l.bledy,
        });
        // Przelewy wpisane wcześniej ręcznie: uzupełniamy istniejący wpis (data z banku, nadawca, tytuł, klucz duplikatu).
        const doPolaczenia = new Set(p.nowe.filter((w) => w.reczna).map((w) => w.reczna.id));
        let zapisane;
        try {
          const nowe = wplaty.filter((w) => !doPolaczenia.has(w.id));
          zapisane = nowe.length ? (await ctx.db.zapiszPakiet({ payments: nowe })).payments : [];
          for (const w of wplaty.filter((x) => doPolaczenia.has(x.id))) {
            const { id, ...zmiany } = w;
            const stara = s.dane.payments.find((x) => x.id === id);
            // Notatka i przypisanie do jednostki zostają (update zmienia tylko podane pola).
            zapisane.push(await ctx.db.zmien('payments', id, { ...zmiany, title: zmiany.title ?? stara?.title ?? null }));
          }
        } catch (e) {
          await ctx.db.usun('imports', importId).catch(() => {});
          throw e;
        }
        const zmiany = { imports: [imp], payments: zapisane };
        // Konto bez numeru rachunku: zapamiętaj numer z pliku – następnym razem konto podpowie się samo.
        const konto = s.indeksy.konta.get(p.kontoId);
        if (konto && !konto.iban && p.rachunek && !s.dane.bank_accounts.some((k) => k.iban === p.rachunek)) {
          zmiany.bank_accounts = [await ctx.db.zmien('bank_accounts', konto.id, { iban: p.rachunek }).catch(() => konto)];
        }
        // Koszty (etap 2) po wpłatach: przy braku migracji 010 wpłaty zostają zapisane, a koszty – komunikat.
        let ostrzezenie = '';
        if (koszty.length) {
          try {
            zmiany.expenses = await ctx.db.zapiszWiele('expenses', koszty, 'id');
            const nowe = [];
            for (const r of reguly) nowe.push(await ctx.db.wstaw('cost_rules', r).catch(() => null));
            zmiany.cost_rules = nowe.filter(Boolean);
          } catch (e) {
            ostrzezenie = `Wypływy nie zapisały się: ${e.message}`;
          }
        }
        ctx.scal(zmiany);
        const czynsz = zapisane.filter((w) => w.kind === 'czynsz');
        s.ui.wyciag = { wynik: {
          zapisane: zapisane.length,
          przypisane: czynsz.filter((w) => w.client_id).length,
          doPrzypisania: czynsz.filter((w) => !w.client_id).length,
          pominiete: zapisane.length - czynsz.length,
          koszty: (zmiany.expenses ?? []).filter((e) => e.category !== POMINIETY).length,
          kosztyPominiete: (zmiany.expenses ?? []).filter((e) => e.category === POMINIETY).length,
          ostrzezenie,
        } };
        s.ui.form = null;
        ctx.toast(ostrzezenie || `Zapisano ${odmiana(zapisane.length, ['wpłatę', 'wpłaty', 'wpłat'])}${koszty.length ? ` i ${odmiana(koszty.length, ['wypływ', 'wypływy', 'wypływów'])}` : ''}`);
        ctx.render();
        globalThis.scrollTo?.(0, 0);
      });
    },
  },
};
