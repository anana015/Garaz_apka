// Import wyciągu (8.3): wybór konta i pliku → podgląd z przypisaniem klientów (7.3) → zapis → wynik.
// Plik czyta przeglądarka; do bazy trafiają tylko wpływy (imports + payments, wpłaty jednym pakietem).

import { kluczeDuplikatow, odczytajWyciag, OBSLUGIWANE } from '../banki.js';
import { dekoduj } from '../csv.js';
import { najemZakonczony, ostatniaWplataNaKoncie } from '../dane.js';
import { formularz, plik, stanFormularza, wybor, zapisz } from '../formularz.js';
import { indeksPlatnikow, rozpoznaj } from '../rozpoznanie.js';
import { przycisk, pustyStan } from '../ui.js';
import {
  esc, dzisiaj, formatData, formatZl, formatRachunek, dataZeZnacznika, noweId, odmiana, porownajKody,
} from '../utils.js';
import { BANKI } from '../walidacja.js';

const LICZBA_OSTATNICH = 10;
const ZNACZNIK = {
  rachunek: { klasa: 'ok', tekst: 'rachunek' },
  nazwa: { klasa: 'czesciowo', tekst: 'nazwa – sprawdź' },
  brak: { klasa: 'wylaczona', tekst: 'brak dopasowania' },
};

// ---------------------------------------------------------------------
// Przygotowanie podglądu (bez DOM)
// ---------------------------------------------------------------------

function przygotuj(s, odczyt, kontoId, nazwaPliku) {
  const istniejace = new Set(s.dane.payments.map((p) => p.dedup_key).filter(Boolean));
  const klucze = kluczeDuplikatow(kontoId, odczyt.wiersze);
  const indeks = indeksPlatnikow(s.dane);
  const l = { razem: odczyt.wiersze.length, wyplywy: 0, duplikaty: 0, bledy: 0 };
  const nowe = [];
  const bledne = [];
  odczyt.wiersze.forEach((w, i) => {
    if (w.blad) { l.bledy += 1; bledne.push(w); return; }
    if (w.kwotaGr <= 0) { l.wyplywy += 1; return; }
    if (istniejace.has(klucze[i])) { l.duplikaty += 1; return; }
    nowe.push({ ...w, klucz: klucze[i], ...rozpoznaj(w, indeks) });
  });
  return { kontoId, nazwaPliku, bank: odczyt.bank, rachunek: odczyt.rachunek, nowe, bledne, l };
}

// ---------------------------------------------------------------------
// Ekran 1: konto i plik
// ---------------------------------------------------------------------

function wyborPliku(s, konta) {
  const f = stanFormularza(s, 'import/plik', () => ({ konto: konta[0]?.id ?? '' }));
  return formularz(f, {
    nazwa: 'wyciag',
    przycisk: 'Wczytaj',
    uwaga: `Obsługiwane wyciągi: ${Object.values(OBSLUGIWANE).join(', ')}. Konto podpowiem z numeru rachunku w pliku.`,
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
    const z = ZNACZNIK[w.klientId ? w.metoda : 'brak'];
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

  const bledne = p.bledne.length ? `<section class="karta"><h2>Wiersze z błędem (nie zapiszą się)</h2>
    <ul class="lista">${p.bledne.map((w) => `<li><div class="wiersz wyciszony"><div class="glowna">
      <strong>Wiersz ${w.nr}: ${esc(w.kontrahent || '—')}</strong><span>${esc(w.blad)}</span></div></div></li>`).join('')}</ul></section>` : '';

  const naglowek = `<section class="karta">
    <h2>${esc(p.nazwaPliku)}</h2>
    <p class="podpowiedz">${esc(OBSLUGIWANE[p.bank] ?? '')} · konto <strong>${esc(konto?.name ?? '?')}</strong>${
  p.rachunek ? ` · <span class="mono">${esc(formatRachunek(p.rachunek))}</span>` : ''}</p>
    <div class="kafelki">
      ${kafelek(p.nowe.length, 'nowe wpłaty')}
      ${kafelek(przypisane.length, 'przypisane automatycznie', `rachunek ${zRachunku} · nazwa ${przypisane.length - zRachunku}`)}
      ${kafelek(p.nowe.length - przypisane.length, 'do przypisania')}
      ${kafelek(p.l.duplikaty + p.l.wyplywy, 'duplikaty i wypływy', `duplikaty ${p.l.duplikaty} · wypływy ${p.l.wyplywy}`)}
    </div></section>`;

  if (!p.nowe.length) {
    const tekst = p.l.razem && p.l.wyplywy === p.l.razem ? 'W tym pliku nie ma wpływów.'
      : p.l.duplikaty ? 'Wszystkie wpłaty z tego pliku są już zapisane.' : 'Brak wpłat do zapisania.';
    return `${naglowek}${pustyStan(tekst, [{ tekst: 'Wczytaj inny plik', akcja: 'anuluj-import' }])}${bledne}`;
  }

  return `${naglowek}
    ${formularz(f, {
    nazwa: 'wyciag-zapis',
    uwaga: 'Sprawdź klientów oznaczonych „nazwa – sprawdź”. Wpłaty bez klienta trafią do „Do przypisania”.',
    przycisk: `Zapisz ${odmiana(p.nowe.length, ['wpłatę', 'wpłaty', 'wpłat'])}`,
    tresc: `<ul class="lista">${wiersze}</ul>`,
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
  w.pominiete ? `, ${w.pominiete} pominięto` : ''}.</p>
    <div class="pasek-akcji">
      ${w.doPrzypisania ? przycisk({ tekst: 'Pokaż do przypisania', akcja: 'do-przypisania' }) : ''}
      ${przycisk({ tekst: 'Wczytaj kolejny wyciąg', akcja: 'anuluj-import', drugi: true })}
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
    return `<div class="siatka">${wyborPliku(s, konta)}<div class="stos">${ostatnieImporty(s)}</div></div>`;
  },

  akcje: {
    'anuluj-import'(_el, ctx) {
      ctx.state.ui.wyciag = null;
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
      const odczyt = odczytajWyciag(dekoduj(await plikWyciagu.arrayBuffer()));
      if (odczyt.blad) {
        f.bledy = { plik: odczyt.blad };
        ctx.render();
        return;
      }
      // Konto z numeru rachunku w pliku (7.2); gdy inne niż wybrane – przełączamy i mówimy o tym.
      let kontoId = f.wartosci.konto;
      const pasujace = odczyt.rachunek && s.dane.bank_accounts.find((k) => k.iban === odczyt.rachunek && !k.archived);
      if (pasujace && pasujace.id !== kontoId) {
        ctx.toast(`Ten wyciąg jest z konta ${pasujace.name} – przełączyłam.`);
        kontoId = pasujace.id;
      }
      const konto = s.indeksy.konta.get(kontoId);
      if (konto && konto.bank !== odczyt.bank && konto.bank !== 'inny') {
        f.bledy = { konto: `Ten plik jest z banku ${OBSLUGIWANE[odczyt.bank]}, a wybrane konto to ${BANKI[konto.bank] ?? konto.bank}.` };
        ctx.render();
        return;
      }
      s.ui.wyciag = { podglad: przygotuj(s, odczyt, kontoId, plikWyciagu.name) };
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
          id: noweId(), booked_on: w.data, amount_gr: w.kwotaGr, kind: pomin ? 'pominieta' : 'czynsz',
          method: 'przelew', bank_account_id: p.kontoId, counterparty: w.kontrahent || null, title: w.tytul || null,
          payer_account: w.rachunekNadawcy, client_id: klient,
          match_method: klient ? (zmieniony ? 'reczne' : w.metoda) : null,
          match_confirmed: Boolean(klient) && (zmieniony || w.potwierdzone),
          dedup_key: w.klucz, import_id: importId,
        };
      });

      await zapisz(ctx, async () => {
        const imp = await ctx.db.wstaw('imports', {
          id: importId, bank_account_id: p.kontoId, file_name: p.nazwaPliku, rows_total: p.l.razem,
          rows_added: wplaty.length, rows_duplicate: p.l.duplikaty, rows_outflow: p.l.wyplywy, rows_error: p.l.bledy,
        });
        let zapisane;
        try {
          zapisane = (await ctx.db.zapiszPakiet({ payments: wplaty })).payments;
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
        ctx.scal(zmiany);
        const czynsz = zapisane.filter((w) => w.kind === 'czynsz');
        s.ui.wyciag = { wynik: {
          zapisane: zapisane.length,
          przypisane: czynsz.filter((w) => w.client_id).length,
          doPrzypisania: czynsz.filter((w) => !w.client_id).length,
          pominiete: zapisane.length - czynsz.length,
        } };
        s.ui.form = null;
        ctx.toast(`Zapisano ${odmiana(zapisane.length, ['wpłatę', 'wpłaty', 'wpłat'])}`);
        ctx.render();
        globalThis.scrollTo?.(0, 0);
      });
    },
  },
};
