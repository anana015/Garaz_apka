// Ustawienia (8.8): konta bankowe, rozliczenia, podatek, dane i konto.
// Adresy: #/ustawienia, #/ustawienia/edycja, #/ustawienia/konto/nowe, #/ustawienia/konto/<id>,
//         #/ustawienia/dane-startowe (import z szablonów CSV, 7.5 – views/startowe.js),
//         #/ustawienia/kopia (wczytanie kopii zapasowej JSON, rozdz. 10),
//         #/ustawienia/promocja/nowa (dodanie promocji do listy w nowym najmie),
//         #/ustawienia/wzor/nowy, #/ustawienia/wzor/<id> (wzory umów do podpisania – views/umowy.js)

import { WERSJA, DNI_PRZYPOMNIENIA_KOPII } from '../config.js';
import {
  formularz, maBledy, opcje, pole, przelacznik, sekcja, stanFormularza, wartosciFormularza, wybor, zapisz,
} from '../formularz.js';
import {
  JSON_W_ZIP, nazwaPlikuKopii, nazwaPlikuZip, planPrzywracania, plikiDokumentow, sprawdzKopie, zbudujKopie,
} from '../kopia.js';
import { czytajWarunki, DOMYSLNE_PROMOCJE, listaPromocji, nowaPozycja, opisWarunkow } from '../promocje.js';
import { pobierzPlik, przycisk, pustyStan } from '../ui.js';
import {
  esc, dzisiaj, dataZeZnacznika, formatData, formatZl, formatProcentBp, formatRachunek, kwotaDoPola, roznicaDni,
} from '../utils.js';
import { BANKI, walidujKonto, walidujUstawienia } from '../walidacja.js';
import startowe from './startowe.js';
import { akcjeWzorow, ekranWzoru, formularzeWzorow, formularzWzoru, kartaWzorow } from './umowy.js';
import { EKSPORTY, pobierzEksport, pokazTerminowosc, ustawienia, ustawTerminowosc } from './wspolne.js';

function sekcjaKarty(id, tytul, tresc, edycja) {
  return `<section class="karta" aria-labelledby="u-${id}">
    <div class="naglowek-karty"><h2 id="u-${id}">${tytul}</h2>${edycja
      ? `<a class="link-btn" href="${edycja}" aria-label="Zmień: ${tytul}">Zmień</a>` : ''}</div>${tresc}</section>`;
}

const pola = (wiersze) => `<dl class="opis-pol">${wiersze
  .map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`;

function kontaBankowe(s) {
  const konta = [...s.dane.bank_accounts].sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name, 'pl'));
  const lista = konta.length
    ? `<ul class="lista">${konta.map((k) => `<li><a class="wiersz" href="#/ustawienia/konto/${encodeURIComponent(k.id)}">
        <div class="glowna"><strong>${esc(k.name)}${k.archived ? ' <span class="wyciszony">(archiwalne)</span>' : ''}</strong>
        <span>${esc(BANKI[k.bank] ?? k.bank)}${k.iban ? ` · <span class="mono">${esc(formatRachunek(k.iban))}</span>` : ''}${
  k.csv_mapping ? ' · kolumny CSV zapamiętane' : ''}</span>
      </div></a></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak kont. Dodaj konta, z których pobierasz wyciągi.</p>';
  return lista + `<div class="pasek-akcji">${przycisk({ tekst: 'Dodaj konto', href: '#/ustawienia/konto/nowe', drugi: true, ikona: 'plus' })}</div>`;
}

/** Lista promocji do wyboru w nowym najmie i w formularzu promocji (settings.promotions). */
function listaPromocjiKarta(s) {
  const lista = listaPromocji(ustawienia(s));
  const html = lista.length
    ? `<ul class="lista">${lista.map((p) => `<li><div class="wiersz"><div class="glowna"><strong>${esc(p.nazwa)}</strong>
        <span>${esc(opisWarunkow(p))}</span></div>
        <div class="prawa"><button type="button" class="link-btn" data-akcja="usun-promocje" data-id="${esc(p.id)}"
          aria-label="Usuń promocję ${esc(p.nazwa)}">Usuń</button></div></div></li>`).join('')}</ul>`
    : '<p class="wyciszony">Lista jest pusta – w nowym najmie zostaje „Bez promocji” i „Inna…”.</p>';
  return `${html}<div class="pasek-akcji">
      ${przycisk({ tekst: 'Dodaj promocję', href: '#/ustawienia/promocja/nowa', drugi: true, ikona: 'plus' })}
      ${Array.isArray(ustawienia(s).promotions) ? '<button type="button" class="przycisk drugi" data-akcja="domyslne-promocje">Przywróć domyślne</button>' : ''}
    </div>
    <p class="podpowiedz">Promocja zapisuje się przy najmie jako obniżona stawka na pierwsze okresy i powrót do normalnej stawki.
      Usunięcie z listy nie zmienia najmów, które już ją mają.</p>`;
}

/** Zapis listy promocji (null = lista domyślna). Wymaga migracji 007. */
async function zapiszListePromocji(ctx, lista, komunikat) {
  const s = ctx.state;
  if (s.podglad || s.offline || s.zKopii || !s.uzytkownik) {
    ctx.toast('Zapis wymaga połączenia z serwerem.');
    return;
  }
  try {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { promotions: lista }) });
    ctx.toast(komunikat);
  } catch (e) {
    ctx.toast(`Nie zapisano listy promocji: ${e.message}`);
  }
}

function formularzNowejPromocji(s) {
  const f = stanFormularza(s, 'ustawienia/promocja/nowa', () => ({ nazwa: '', rabat: '50', okresy: '1' }));
  return formularz(f, {
    nazwa: 'nowa-promocja', przycisk: 'Dodaj do listy', anuluj: '#/ustawienia',
    tresc: `
      ${pole(f, { nazwa: 'nazwa', etykieta: 'Nazwa', wymagane: true, atrybuty: 'maxlength="60"',
        podpowiedz: 'Tak będzie widoczna na liście i w historii stawek, np. „Zniżka na pierwszy miesiąc”.' })}
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'rabat', etykieta: 'Rabat (%)', wymagane: true, atrybuty: 'inputmode="decimal"' })}
        ${pole(f, { nazwa: 'okresy', etykieta: 'Ile okresów', wymagane: true, atrybuty: 'inputmode="numeric"',
          podpowiedz: 'Liczone od startu najmu i zaokrąglane do 1. dnia miesiąca (np. 2 mies. od 05.09 → do 31.10).' })}
      </div>`,
  });
}

async function zapiszNowaPromocje(form, ctx) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const { bledy, rabat, okresy } = czytajWarunki(w);
  const nazwa = String(w.nazwa ?? '').trim();
  if (!nazwa) bledy.nazwa = 'Podaj nazwę.';
  else if (nazwa.length > 60) bledy.nazwa = 'Nazwa do 60 znaków.';
  const lista = listaPromocji(ustawienia(s));
  if (nazwa && lista.some((p) => p.nazwa.toLowerCase() === nazwa.toLowerCase())) bledy.nazwa = 'Promocja o tej nazwie już jest.';
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const pozycja = nowaPozycja(lista, { nazwa, rabat, okresy });
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { promotions: [...lista, pozycja] }) });
    ctx.toast(`Dodano promocję „${pozycja.nazwa}”`);
    ctx.nawiguj('ustawienia');
  });
}

/** Pasek „Ostatnia kopia: [data]. Zapisz nową” po 30 dniach (rozdz. 10). */
function przypomnienieKopii(u) {
  if (!u.last_backup_at) return '<div class="baner ostrzezenie">Nie zapisano jeszcze kopii zapasowej.</div>';
  const data = dataZeZnacznika(u.last_backup_at);
  return roznicaDni(data, dzisiaj()) > DNI_PRZYPOMNIENIA_KOPII
    ? `<div class="baner ostrzezenie">Ostatnia kopia: ${formatData(data)}. Zapisz nową.</div>` : '';
}

function przeglad(s) {
  const u = ustawienia(s);
  const ostatni = u.default_last_period === 'pelny' ? 'pełny okres' : 'proporcjonalnie';
  return `
    <div class="siatka">
      ${sekcjaKarty('konta', 'Konta bankowe', kontaBankowe(s))}
      ${sekcjaKarty('jednostki', 'Jednostki i stawki', `${pola([
        ['Jednostki', `${s.dane.units.filter((j) => !j.archived).length} (wyłączone z najmu: ${
          s.dane.units.filter((j) => !j.archived && j.out_of_service).length})`],
      ])}
        <div class="pasek-akcji">
          ${przycisk({ tekst: 'Dodaj jednostkę', href: '#/jednostki/nowa', drugi: true, ikona: 'plus' })}
          ${przycisk({ tekst: 'Zmień stawki wielu najmów', href: '#/najmy/podwyzka', drugi: true })}
        </div>
        <p class="podpowiedz">Dane pojedynczej jednostki zmienisz w jej szczegółach (Jednostki → jednostka → Edytuj).</p>`)}
      ${sekcjaKarty('promocje', 'Promocje', listaPromocjiKarta(s))}
      ${sekcjaKarty('wzory', 'Wzory umów', kartaWzorow(s))}
      ${sekcjaKarty('bramy', 'Bramy', `<p>${s.dane.gates?.length ? `Sterowniki: ${s.dane.gates.length}. Numery SIM, hasła i polecenia
          są tylko w bazie (Supabase → tabela gates).` : 'Brak danych bram – uruchom migrację 012 i supabase/jednorazowe/bramy_wpisz.sql.'}</p>
        <div class="pasek-akcji">${przycisk({ tekst: 'Bramy – przypisania i usunięcia', href: '#/bramy', drugi: true })}</div>`)}
      ${sekcjaKarty('rozliczenia', 'Rozliczenia', pola([
        ['Tolerancja terminowości', `${u.tolerance_days} dni`],
        ['Okno terminowości', `${u.punctuality_months} mies.`],
        ['Ostrzeżenie o końcu umowy', `${u.expiring_days} dni wcześniej`],
        ['Ostatni okres najmu', ostatni],
        ['Dzień płatności nowych najmów', `${u.default_billing_day ?? 20}.`],
      ]), '#/ustawienia/edycja')}
      ${sekcjaKarty('karta-klienta', 'Karta klienta', `${pola([['Karta „Terminowość”', pokazTerminowosc() ? 'widoczna' : 'ukryta']])}
        <div class="pasek-akcji"><button type="button" class="przycisk drugi" data-akcja="terminowosc-klienta">
          ${pokazTerminowosc() ? 'Ukryj terminowość' : 'Pokaż terminowość'}</button></div>
        <p class="podpowiedz">Dotyczy karty klienta i karty „Terminowość” w Raportach. Ustawienie dotyczy tego urządzenia.</p>`)}
      ${sekcjaKarty('podatek', 'Podatek', pola([
        ['Wpłaty ryczałtu', u.tax_period === 'miesiac' ? 'miesięcznie' : 'kwartalnie'],
        ['Stawki', `${formatProcentBp(u.tax_rate_low_bp)} / ${formatProcentBp(u.tax_rate_high_bp)}`],
        ['Próg wyższej stawki', `<span class="kwota">${formatZl(u.tax_threshold_gr, { grosze: false })}</span>`],
        ['Limit zwolnienia z VAT', `<span class="kwota">${formatZl(u.vat_limit_gr, { grosze: false })}</span>`],
        ['Mikrorachunek podatkowy', u.tax_account ? `<span class="mono">${esc(formatRachunek(u.tax_account))}</span>` : 'nie podano'],
      ]), '#/ustawienia/edycja')}
      ${sekcjaKarty('dane', 'Dane', `${przypomnienieKopii(u)}${pola([['Data startu danych', formatData(u.data_start)]])}
        <div class="pasek-akcji">
          ${przycisk({ tekst: 'Zapisz kopię', akcja: 'kopia' })}
          ${przycisk({ tekst: 'Zapisz kopię z dokumentami', akcja: 'kopia-zip', drugi: true })}
          ${przycisk({ tekst: 'Wczytaj kopię', href: '#/ustawienia/kopia', drugi: true })}
          ${przycisk({ tekst: 'Wczytaj dane startowe', href: '#/ustawienia/dane-startowe', drugi: true })}
        </div>
        <p class="podpowiedz">Kopia to plik JSON ze wszystkimi danymi. Kopia z dokumentami to plik ZIP: te same dane oraz
          PDF-y umów i wzory umów – trwa dłużej i wymaga połączenia z bazą.
          Plik zawiera dane osobowe klientów – przechowuj go w bezpiecznym miejscu.</p>`, '#/ustawienia/edycja')}
      ${sekcjaKarty('eksporty', 'Eksporty CSV', `<p class="podpowiedz">Pliki dla Excela i księgowej: średnik, polskie znaki, kwoty z przecinkiem.</p>
        <div class="pasek-akcji">${Object.entries(EKSPORTY).map(([rodzaj, tekst]) =>
    `<button type="button" class="przycisk drugi" data-akcja="eksport" data-rodzaj="${rodzaj}">${esc(tekst)}</button>`).join('')}
        </div>
        <p class="podpowiedz">Wpłaty – wszystkie zapisane, z klientem, kontem i formą. Ryczałt – bieżący rok;
          inne lata w Raportach (okres „Rok”).</p>`)}
      ${sekcjaKarty('konto', 'Konto', s.podglad
        ? '<p class="wyciszony">Tryb podglądu – brak logowania.</p>'
        : `${pola([['Zalogowano jako', esc(s.uzytkownik?.email ?? '—')]])}
           <div class="pasek-akcji">${przycisk({ tekst: 'Wyloguj', akcja: 'wyloguj', drugi: true, ikona: 'wyloguj' })}</div>`)}
    </div>
    <p class="wyciszony maly">Wersja ${esc(WERSJA)}</p>`;
}

// ---------------------------------------------------------------------
// Edycja ustawień
// ---------------------------------------------------------------------

const procentDoPola = (bp) => (bp == null ? '' : String(bp / 100).replace('.', ','));

function wartosciUstawien(u) {
  return {
    tolerance_days: String(u.tolerance_days), punctuality_months: String(u.punctuality_months),
    expiring_days: String(u.expiring_days), default_last_period: u.default_last_period, tax_period: u.tax_period,
    default_billing_day: String(u.default_billing_day ?? 20),
    tax_rate_low_bp: procentDoPola(u.tax_rate_low_bp), tax_rate_high_bp: procentDoPola(u.tax_rate_high_bp),
    tax_threshold_gr: kwotaDoPola(u.tax_threshold_gr), vat_limit_gr: kwotaDoPola(u.vat_limit_gr),
    tax_account: u.tax_account ? formatRachunek(u.tax_account) : '', data_start: u.data_start,
  };
}

function formularzUstawien(s) {
  const f = stanFormularza(s, 'ustawienia/edycja', () => wartosciUstawien(ustawienia(s)));
  const liczba = 'inputmode="numeric" min="0"';
  return formularz(f, {
    nazwa: 'ustawienia', przycisk: 'Zapisz ustawienia', anuluj: '#/ustawienia',
    tresc: `
      ${sekcja('Rozliczenia', `
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tolerance_days', etykieta: 'Tolerancja terminowości (dni)', typ: 'number', wymagane: true,
            podpowiedz: 'Wpłata do tylu dni po terminie jest terminowa (Z28).', atrybuty: liczba })}
          ${pole(f, { nazwa: 'punctuality_months', etykieta: 'Okno terminowości (mies.)', typ: 'number', wymagane: true,
            podpowiedz: 'Z ilu ostatnich miesięcy liczyć terminowość (Z30).', atrybuty: liczba })}
        </div>
        <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'expiring_days', etykieta: 'Ostrzeżenie o końcu umowy (dni wcześniej)', typ: 'number', wymagane: true,
          atrybuty: liczba })}
        ${pole(f, { nazwa: 'default_billing_day', etykieta: 'Dzień płatności nowych najmów', typ: 'number', wymagane: true,
          podpowiedz: 'Termin zapłaty za cały bieżący miesiąc. Okresy to miesiące kalendarzowe; niepełny pierwszy miesiąc – proporcjonalnie.', atrybuty: 'min="1" max="31" inputmode="numeric"' })}
        </div>
        ${opcje(f, { nazwa: 'default_last_period', legenda: 'Domyślny ostatni okres nowego najmu (Z8)', opcje: [
          { wartosc: 'proporcjonalnie', tekst: 'Proporcjonalnie do dni' }, { wartosc: 'pelny', tekst: 'Pełny okres' }] })}`)}
      ${sekcja('Podatek', `
        ${opcje(f, { nazwa: 'tax_period', legenda: 'Wpłaty ryczałtu', opcje: [
          { wartosc: 'kwartal', tekst: 'Kwartalnie' }, { wartosc: 'miesiac', tekst: 'Miesięcznie' }] })}
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tax_rate_low_bp', etykieta: 'Stawka do progu (%)', wymagane: true, atrybuty: 'inputmode="decimal"' })}
          ${pole(f, { nazwa: 'tax_rate_high_bp', etykieta: 'Stawka ponad próg (%)', wymagane: true, atrybuty: 'inputmode="decimal"' })}
        </div>
        <div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'tax_threshold_gr', etykieta: 'Próg wyższej stawki (zł)', typ: 'kwota', wymagane: true })}
          ${pole(f, { nazwa: 'vat_limit_gr', etykieta: 'Limit zwolnienia z VAT (zł)', typ: 'kwota', wymagane: true })}
        </div>
        ${pole(f, { nazwa: 'tax_account', etykieta: 'Mikrorachunek podatkowy', atrybuty: 'inputmode="numeric" autocomplete="off"',
          podpowiedz: '26 cyfr. Pokazywany przy kwocie ryczałtu do zapłaty.' })}`)}
      ${sekcja('Dane', `
        ${pole(f, { nazwa: 'data_start', etykieta: 'Data startu danych', typ: 'date', wymagane: true,
          podpowiedz: 'Należności liczone są od tej daty, wcześniejszy stan to saldo otwarcia klienta (Z34). Zmiana przelicza wszystko od razu.' })}`)}`,
  });
}

async function zapiszUstawienia(form, ctx) {
  const s = ctx.state;
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujUstawienia(w, { dzis: dzisiaj() });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, wiersz) });
    ctx.toast('Ustawienia zapisane');
    ctx.nawiguj('ustawienia');
  });
}


// ---------------------------------------------------------------------
// Kopia zapasowa (rozdz. 10)
// ---------------------------------------------------------------------

/** Zapisuje datę ostatniej kopii w ustawieniach (przypomnienie po 30 dniach). */
async function zapamietajKopie(ctx, teraz) {
  const s = ctx.state;
  if (s.podglad || s.offline || s.zKopii || !s.uzytkownik) return;
  try {
    ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { last_backup_at: teraz }) });
  } catch {
    // Plik i tak został pobrany; data ostatniej kopii zapisze się następnym razem.
  }
}

/** Pobiera plik kopii bieżących danych (JSON) i zapisuje datę ostatniej kopii w ustawieniach. */
async function zapiszKopie(ctx, { cicho = false } = {}) {
  const s = ctx.state;
  const teraz = new Date().toISOString();
  pobierzPlik(nazwaPlikuKopii(teraz), JSON.stringify(zbudujKopie(s.dane, { wersjaAplikacji: WERSJA, teraz }), null, 1),
    'application/json');
  await zapamietajKopie(ctx, teraz);
  if (!cicho) ctx.toast('Kopia zapasowa zapisana. Plik zawiera dane osobowe klientów.');
}

/** Kopia z dokumentami (rozdz. 10): ZIP z kopia.json, umowy/<id umowy>.pdf i wzory/<id wzoru>.docx. */
async function zapiszKopieZip(ctx) {
  const s = ctx.state;
  if (s.podglad || s.offline || s.zKopii || !s.uzytkownik) {
    ctx.toast('Kopia z dokumentami wymaga połączenia z bazą. Zapisz zwykłą kopię.');
    return;
  }
  if (s.ui.trwaKopiaZip) return;
  s.ui.trwaKopiaZip = true;
  try {
    const JSZip = await ctx.db.jszip();
    const teraz = new Date().toISOString();
    const zip = new JSZip();
    zip.file(JSON_W_ZIP, JSON.stringify(zbudujKopie(s.dane, { wersjaAplikacji: WERSJA, teraz }), null, 1));
    const pliki = plikiDokumentow(s.dane, s.uzytkownik.id);
    const bledy = [];
    let gotowe = 0;
    if (pliki.length) ctx.toast(`Pobieram dokumenty (${pliki.length})…`);
    // Po kilka naraz – szybciej niż po jednym, a nie zapycha połączenia.
    for (let i = 0; i < pliki.length; i += 4) {
      await Promise.all(pliki.slice(i, i + 4).map(async (p) => {
        try {
          zip.file(p.wZip, await ctx.db.pobierzZMagazynu(p.sciezka));
          gotowe += 1;
        } catch {
          bledy.push(p.wZip);
        }
      }));
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    pobierzPlik(nazwaPlikuZip(teraz), blob, 'application/zip');
    await zapamietajKopie(ctx, teraz);
    ctx.toast(bledy.length
      ? `Kopia zapisana, ale ${bledy.length} z ${pliki.length} plików nie udało się pobrać (np. ${bledy[0]}).`
      : `Kopia z dokumentami zapisana (${gotowe} plików). Zawiera dane osobowe klientów.`);
  } catch (e) {
    ctx.toast(e.message);
  } finally {
    s.ui.trwaKopiaZip = false;
  }
}

const NAZWY_TABEL = {
  units: 'jednostki', clients: 'klienci', contracts: 'umowy', rentals: 'najmy', rental_rates: 'stawki',
  charge_adjustments: 'korekty', bank_accounts: 'konta', imports: 'importy', payments: 'wpłaty', payers: 'płatnicy',
  deposits: 'ruchy kaucji', client_notes: 'notatki', tax_payments: 'wpłaty ryczałtu', settings: 'ustawienia',
  expenses: 'koszty', cost_rules: 'reguły kosztów',
};

function ekranKopii(s) {
  const f = stanFormularza(s, 'ustawienia/kopia', () => ({ potwierdzam: '' }));
  const p = f.podglad;
  let podsumowanie = '';
  if (p?.blad) podsumowanie = `<p class="blad-tekst" role="alert">${esc(p.blad)}</p>`;
  else if (p?.kopia) {
    const teraz = Object.fromEntries(Object.keys(NAZWY_TABEL).map((t) => [t, t === 'settings' ? (s.dane.settings ? 1 : 0) : s.dane[t].length]));
    podsumowanie = `<p>Plik <strong>${esc(p.nazwa)}</strong> · zapisany ${esc(new Date(p.kopia.exported_at).toLocaleString('pl-PL'))}${
      p.kopia.app_version ? ` · wersja ${esc(p.kopia.app_version)}` : ''}${
      p.zip ? ` · dokumenty: ${p.zip.pdf} PDF umów, ${p.zip.wzory} wzorów` : ''}</p>
      <div class="tabela-przewijana"><table class="tabela"><thead><tr><th scope="col">Dane</th>
        <th scope="col" class="kwota">W kopii</th><th scope="col" class="kwota">Teraz</th></tr></thead>
        <tbody>${Object.entries(NAZWY_TABEL).filter(([t]) => p.liczby[t] || teraz[t]).map(([t, nazwa]) => `<tr><td>${esc(nazwa)}</td>
          <td class="kwota">${p.liczby[t]}</td><td class="kwota">${teraz[t]}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `<section class="karta">
      <p class="baner ostrzezenie">Wczytanie kopii <strong>zastępuje wszystkie obecne dane</strong> danymi z pliku.
        Najpierw pobiorę kopię obecnych danych, żeby można było wrócić.</p>
      <div class="pole"><label for="plik-kopii">Plik kopii (.json albo .zip z dokumentami)</label>
        <input id="plik-kopii" type="file" accept=".json,.zip,application/json,application/zip" data-zmiana="plik-kopii"></div>
      ${podsumowanie}
    </section>
    ${p?.kopia ? formularz(f, {
    nazwa: 'kopia',
    uwaga: '',
    przycisk: 'Wczytaj kopię',
    anuluj: '#/ustawienia',
    tresc: przelacznik(f, { nazwa: 'potwierdzam', etykieta: 'Rozumiem, że obecne dane zostaną zastąpione danymi z kopii' }),
  }) : ''}`;
}

// ---------------------------------------------------------------------
// Konto bankowe
// ---------------------------------------------------------------------

function formularzKonta(s, konto) {
  const f = stanFormularza(s, `ustawienia/konto/${s.ui.akcja}`, () => (konto
    ? { name: konto.name, bank: konto.bank, iban: konto.iban ? formatRachunek(konto.iban) : '', archived: konto.archived ? 'on' : '' }
    : { bank: '' }));
  return formularz(f, {
    nazwa: 'konto', przycisk: konto ? 'Zapisz konto' : 'Dodaj konto', anuluj: '#/ustawienia',
    tresc: `
      ${pole(f, { nazwa: 'name', etykieta: 'Nazwa', wymagane: true, podpowiedz: 'Np. „Nest – najem”.', atrybuty: 'maxlength="60"' })}
      ${wybor(f, { nazwa: 'bank', etykieta: 'Bank', wymagane: true, pusta: 'Wybierz…',
        opcje: Object.entries(BANKI).map(([wartosc, tekst]) => ({ wartosc, tekst })),
        podpowiedz: 'Określa sposób odczytu wyciągu CSV (7.1).' })}
      ${pole(f, { nazwa: 'iban', etykieta: 'Numer rachunku', atrybuty: 'inputmode="numeric" autocomplete="off"',
        podpowiedz: '26 cyfr. Pozwala rozpoznać konto po nagłówku wyciągu.' })}
      ${konto ? przelacznik(f, { nazwa: 'archived', etykieta: 'Konto archiwalne (nie pokazuj przy imporcie)' }) : ''}`,
  });
}

async function zapiszKonto(form, ctx) {
  const s = ctx.state;
  const konto = s.ui.akcja === 'nowe' ? null : s.indeksy.konta.get(s.ui.akcja);
  const w = wartosciFormularza(form);
  const { bledy, wiersz } = walidujKonto(w, { konta: s.dane.bank_accounts, id: konto?.id ?? null });
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const zapisane = konto ? await ctx.db.zmien('bank_accounts', konto.id, wiersz) : await ctx.db.wstaw('bank_accounts', wiersz);
    ctx.scal({ bank_accounts: [zapisane] });
    ctx.toast(konto ? 'Konto zapisane' : `Dodano konto ${zapisane.name}`);
    ctx.nawiguj('ustawienia');
  });
}

// ---------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------

export default {
  tytul(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'edycja') return 'Edycja ustawień';
    if (parametr === 'konto') return akcja === 'nowe' ? 'Nowe konto' : 'Konto bankowe';
    if (parametr === 'dane-startowe') return startowe.tytul(s);
    if (parametr === 'kopia') return 'Wczytaj kopię';
    if (parametr === 'promocja') return 'Nowa promocja';
    if (parametr === 'wzor') return akcja === 'nowy' ? 'Nowy wzór umowy' : 'Wzór umowy';
    return 'Ustawienia';
  },

  wstecz: (s) => (s.ui.parametr ? { href: '#/ustawienia', tekst: 'Ustawienia' } : null),

  render(s) {
    const { parametr, akcja } = s.ui;
    if (parametr === 'edycja') return formularzUstawien(s);
    if (parametr === 'dane-startowe') return startowe.render(s);
    if (parametr === 'kopia') return ekranKopii(s);
    if (parametr === 'promocja') return formularzNowejPromocji(s);
    if (parametr === 'wzor') return akcja === 'nowy' ? formularzWzoru(s) : ekranWzoru(s);
    if (parametr === 'konto') {
      const konto = akcja === 'nowe' ? null : s.indeksy.konta.get(akcja);
      if (akcja !== 'nowe' && !konto) return pustyStan('Nie znaleziono konta.', [{ tekst: 'Ustawienia', href: '#/ustawienia' }]);
      return formularzKonta(s, konto);
    }
    return przeglad(s);
  },

  akcje: {
    /** Włącza / wyłącza kartę „Terminowość” na karcie klienta (localStorage, bez bazy). */
    'terminowosc-klienta'(el, ctx) {
      ustawTerminowosc(!pokazTerminowosc());
      ctx.toast(pokazTerminowosc() ? 'Terminowość będzie widoczna na karcie klienta.' : 'Terminowość ukryta na karcie klienta.');
      ctx.render();
    },
    ...akcjeWzorow,
    kopia: (_el, ctx) => zapiszKopie(ctx),
    'kopia-zip': (_el, ctx) => zapiszKopieZip(ctx),
    eksport: (el, ctx) => pobierzEksport(ctx.state, el.dataset.rodzaj),
    'usun-promocje'(el, ctx) {
      const lista = listaPromocji(ustawienia(ctx.state));
      const p = lista.find((x) => x.id === el.dataset.id);
      if (!p) return;
      el.setAttribute('aria-disabled', 'true');
      zapiszListePromocji(ctx, lista.filter((x) => x.id !== p.id), `Usunięto promocję „${p.nazwa}” z listy`);
    },
    'domyslne-promocje'(el, ctx) {
      el.setAttribute('aria-disabled', 'true');
      zapiszListePromocji(ctx, null, `Przywrócono domyślne promocje (${DOMYSLNE_PROMOCJE.length})`);
    },
    async wyloguj(el, ctx) {
      el.setAttribute('aria-disabled', 'true');
      try {
        await ctx.db.wyloguj();   // app.js przełączy na logowanie po zmianie sesji
      } catch {
        el.removeAttribute('aria-disabled');
        ctx.toast('Nie udało się wylogować. Sprawdź połączenie.');
      }
    },
    ...startowe.akcje,
  },

  zmiany: {
    ...startowe.zmiany,
    /** Wybór pliku kopii: odczyt i sprawdzenie przed zapisem (nic jeszcze nie zmienia w bazie). */
    async 'plik-kopii'(el, ctx) {
      const plik = el.files?.[0];
      const f = stanFormularza(ctx.state, 'ustawienia/kopia', () => ({ potwierdzam: '' }));
      if (!plik) return;
      let wynik;
      if (/\.zip$/i.test(plik.name) || plik.type === 'application/zip') {
        try {
          const JSZip = await ctx.db.jszip();
          const zip = await JSZip.loadAsync(plik);
          const json = zip.file(JSON_W_ZIP);
          if (!json) wynik = { blad: 'W pliku ZIP nie ma kopii danych (kopia.json).' };
          else {
            const nazwy = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
            wynik = { ...sprawdzKopie(await json.async('string')), plikZip: zip, nazwyZip: nazwy,
              zip: { pdf: nazwy.filter((n) => n.startsWith('umowy/')).length, wzory: nazwy.filter((n) => n.startsWith('wzory/')).length } };
          }
        } catch {
          wynik = { blad: 'Nie udało się otworzyć pliku ZIP.' };
        }
      } else wynik = sprawdzKopie(await plik.text());
      f.podglad = { nazwa: plik.name, ...wynik };
      f.wartosci = { potwierdzam: '' };
      f.bledy = {};
      ctx.render();
    },
  },

  formularze: {
    ...formularzeWzorow,
    ustawienia: zapiszUstawienia,
    konto: zapiszKonto,
    'nowa-promocja': zapiszNowaPromocje,
    /** Wczytanie kopii: najpierw plik z obecnymi danymi, potem zastąpienie wszystkiego w jednej transakcji. */
    async kopia(form, ctx) {
      const f = ctx.state.ui.form;
      const kopia = f?.podglad?.kopia;
      if (!kopia) return;
      const w = wartosciFormularza(form);
      if (maBledy(ctx, w, w.potwierdzam === 'on' ? {} : { potwierdzam: 'Zaznacz, że rozumiesz skutki wczytania kopii.' })) return;
      const zip = f.podglad.plikZip;
      await zapisz(ctx, async () => {
        await zapiszKopie(ctx, { cicho: true });
        const plan = zip ? planPrzywracania(kopia, f.podglad.nazwyZip, ctx.state.uzytkownik.id) : { kopia, doWgrania: [] };
        const liczby = await ctx.db.wczytajKopie(plan.kopia.tables);
        // Dokumenty z ZIP-a – po wczytaniu danych (pliki nadpisują się, więc ponowne wczytanie nic nie psuje).
        let bledy = 0;
        for (const p of plan.doWgrania) {
          try {
            await ctx.db.wgrajDoMagazynu(p.sciezka, await zip.file(p.wZip).async('blob'), p.typ);
          } catch {
            bledy += 1;
          }
        }
        await ctx.odswiez();
        ctx.toast(`Wczytano kopię: ${liczby.clients ?? 0} klientów, ${liczby.payments ?? 0} wpłat${
          plan.doWgrania.length ? `, ${plan.doWgrania.length - bledy} dokumentów` : ''}${bledy ? ` (${bledy} plików się nie wgrało)` : ''}`);
        ctx.nawiguj('pulpit');
      });
    },
    ...startowe.formularze,
  },
};
