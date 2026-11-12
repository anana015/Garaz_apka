// Prąd – rozliczenie kwartalne (prośba 12.11.2026): #/prad[?kw=RRRR-K]
// Lista jednostek z prądem: najemca, poprzedni odczyt, pole na stan licznika, zużycie i kwota. „Zapisz odczyty”:
// odczyt (power_readings) + doliczenie kwoty do należności klienta w wybranym miesiącu (charge_adjustments).
// Pierwszy odczyt w najmie – bez opłaty (stan początkowy). Logika: js/prad.js.

import { formularz, maBledy, stanFormularza, wartosciFormularza, wybor, pole, zapisz } from '../formularz.js';
import {
  czytajKwh, formatKwh, kwartal, kwartalDoRozliczenia, kwartalNr, kwotaZaPrad, miesiacDoliczenia, poprzedniKwartal,
  poprzedniOdczyt, powodOplaty, wierszePradu,
} from '../prad.js';
import { filtry, pustyStan } from '../ui.js';
import { dodajMiesiace, dzisiaj, esc, formatData, formatZl } from '../utils.js';
import { nazwaMiesiaca, ustawienia } from './wspolne.js';

const bezPolaczenia = (s) => s.podglad || s.offline || s.zKopii || !s.uzytkownik;
const STATUS = {
  rozliczony: { tekst: 'rozliczony', klasa: 'ok' },
  poczatkowy: { tekst: 'brak odczytu początkowego', klasa: 'czesciowo' },
  'do-odczytu': { tekst: 'do odczytu', klasa: 'czesciowo' },
  wolna: { tekst: 'wolna', klasa: '' },
};

function wybranyKwartal(s) {
  const m = String(s.ui.filtry?.prad ?? s.ui.zapytanie.kw ?? '').match(/^(\d{4})-([1-4])$/);
  return m ? kwartalNr(Number(m[1]), Number(m[2])) : kwartalDoRozliczenia(dzisiaj());
}

const cenaGr = (s) => ustawienia(s).power_price_gr ?? 130;
const zlNaPole = (gr) => (gr / 100).toFixed(2).replace('.', ',');

function render(s) {
  const k = wybranyKwartal(s);
  const dzis = dzisiaj();
  const wiersze = wierszePradu(s.dane, s.indeksy, k);
  if (!s.dane.units.some((u) => u.has_power)) {
    return pustyStan('Żadna jednostka nie jest oznaczona jako „z prądem”. Oznacz ją w danych jednostki.', [{ tekst: 'Jednostki', href: '#/jednostki' }]);
  }
  const biezacy = kwartal(dzis);
  const kwartaly = [biezacy, poprzedniKwartal(biezacy), poprzedniKwartal(poprzedniKwartal(biezacy))];
  const wybor4 = filtry(kwartaly.map((x) => ({ id: x.klucz, tekst: x.nazwa })), k.klucz, 'Kwartał');

  const domyslnaData = k.do < dzis ? k.do : dzis;
  const f = stanFormularza(s, `prad/${k.klucz}`, () => ({
    data: domyslnaData, cena: zlNaPole(cenaGr(s)), miesiac: miesiacDoliczenia(k, null),
  }));
  const cena = Math.round((Number(String(f.wartosci.cena ?? '').replace(',', '.')) || 0) * 100) || cenaGr(s);
  const miesiace = [0, 1, 2, 3].map((i) => dodajMiesiace(dodajMiesiace(k.od, 2), i))
    .map((m) => ({ wartosc: m, tekst: nazwaMiesiaca(m) }));

  const wiersz = (w) => {
    const st = STATUS[w.status];
    const nazwa = `kwh_${w.jednostka.id}`;
    const wpisane = f.wartosci[nazwa] ?? '';
    const kwh = czytajKwh(wpisane);
    let podglad = '';
    if (wpisane && kwh == null) podglad = '<span class="status zalega">wpisz liczbę, np. 1234,5</span>';
    else if (kwh != null && w.poprzedni && w.najem) {
      const zuzycie = Math.round((kwh - Number(w.poprzedni.kwh)) * 10) / 10;
      podglad = zuzycie < 0 ? '<span class="status zalega">mniej niż poprzednio</span>'
        : `${formatKwh(zuzycie)} kWh · <strong class="kwota">${formatZl(kwotaZaPrad(zuzycie, cena))}</strong>`;
    } else if (kwh != null) podglad = '<span class="wyciszony">odczyt początkowy – bez opłaty</span>';
    const zapisany = w.odczytKwartalu
      ? `<span class="maly">${formatData(w.odczytKwartalu.read_on)}: ${formatKwh(w.odczytKwartalu.kwh)} kWh · doliczono ${formatZl(w.odczytKwartalu.amount_gr)}</span>` : '';
    return `<li><div class="wiersz"><div class="glowna">
        <strong><a class="mono" href="#/jednostki/${encodeURIComponent(w.jednostka.id)}">${esc(w.jednostka.code)}</a>
          ${w.klient ? ` · <a href="#/klienci/${encodeURIComponent(w.klient.id)}">${esc(w.klient.name)}</a>` : ''}</strong>
        <span>${w.poprzedni ? `poprzednio ${formatData(w.poprzedni.read_on)}: ${formatKwh(w.poprzedni.kwh)} kWh` : 'brak poprzedniego odczytu'}
          · <span class="status ${st.klasa}">${st.tekst}</span></span>
        ${zapisany}
        ${w.status === 'rozliczony' ? '' : `<span class="maly">${podglad}</span>`}</div>
      <div class="prawa">${w.status === 'rozliczony' ? '' : `<input class="pole-kwh" name="${esc(nazwa)}" inputmode="decimal" autocomplete="off"
        placeholder="kWh" aria-label="Stan licznika ${esc(w.jednostka.code)}" value="${esc(wpisane)}" data-odswiez>`}</div></div></li>`;
  };

  const doWpisania = wiersze.filter((w) => w.status !== 'rozliczony');
  const historia = [...(s.dane.power_readings ?? [])].sort((a, b) => b.read_on.localeCompare(a.read_on)
    || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 15);
  const ostatnieJednostek = new Set();
  for (const o of [...(s.dane.power_readings ?? [])].sort((a, b) => b.read_on.localeCompare(a.read_on))) {
    if (![...ostatnieJednostek].some((x) => x.unit_id === o.unit_id)) ostatnieJednostek.add(o);
  }

  return `${wybor4}
    ${formularz(f, {
    nazwa: 'odczyty-pradu',
    przycisk: 'Zapisz odczyty i dolicz do należności',
    anuluj: '#/jednostki',
    uwaga: '',
    tresc: `<p class="podpowiedz">Wpisz stan licznika (kWh) przy jednostkach. Zużycie = stan − poprzedni odczyt; kwota trafia do
        należności klienta w wybranym miesiącu (widać ją w „Kwotach w miesiącach” i w kartotece). Pierwszy odczyt w najmie to
        stan początkowy – bez opłaty.</p>
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'data', etykieta: 'Data odczytu', typ: 'date', wymagane: true, odswiez: true })}
        ${pole(f, { nazwa: 'cena', etykieta: 'Cena 1 kWh brutto (zł)', wymagane: true, odswiez: true, atrybuty: 'inputmode="decimal"' })}
        ${wybor(f, { nazwa: 'miesiac', etykieta: 'Doliczyć do należności za', opcje: miesiace, odswiez: true,
    podpowiedz: 'Termin płatności – 20. dnia tego miesiąca.' })}
      </div>
      <ul class="lista">${wiersze.map(wiersz).join('')}</ul>
      ${!doWpisania.length ? '<p class="baner"><span>Wszystkie jednostki z najmem są rozliczone za ten kwartał.</span></p>' : ''}`,
  })}
    <section class="karta"><h2>Ostatnie odczyty</h2>
      ${historia.length ? `<ul class="lista">${historia.map((o) => {
    const j = s.indeksy.jednostki.get(o.unit_id);
    const pytanie = s.ui.usunOdczyt === o.id;
    const mozna = ostatnieJednostek.has(o);
    return `<li><div class="wiersz"><div class="glowna"><strong><span class="mono">${esc(j?.code ?? '?')}</span> · ${formatData(o.read_on)}</strong>
        <span>${formatKwh(o.kwh)} kWh${o.amount_gr != null ? ` · doliczono ${formatZl(o.amount_gr)}` : ' · odczyt początkowy'}</span>
        ${pytanie ? `<span>Usunąć odczyt${o.adjustment_id ? ' i doliczoną kwotę' : ''}?
          <button type="button" class="link-btn" data-akcja="usun-odczyt-tak" data-id="${esc(o.id)}">Tak, usuń</button> ·
          <button type="button" class="link-btn" data-akcja="usun-odczyt-nie">Nie</button></span>` : ''}</div>
      <div class="prawa">${mozna && !pytanie ? `<button type="button" class="link-btn maly" data-akcja="usun-odczyt" data-id="${esc(o.id)}">usuń</button>` : ''}</div>
      </div></li>`;
  }).join('')}</ul>
      <p class="podpowiedz">Usunąć można ostatni odczyt jednostki (np. pomyłka) – razem z doliczoną kwotą.</p>`
    : '<p class="wyciszony">Brak odczytów.</p>'}</section>`;
}

async function zapiszOdczyty(form, ctx) {
  const s = ctx.state;
  const k = wybranyKwartal(s);
  const w = wartosciFormularza(form);
  const bledy = {};
  const cena = Math.round(Number(String(w.cena ?? '').replace(',', '.')) * 100);
  if (!(cena > 0 && cena < 10000)) bledy.cena = 'Podaj cenę, np. 1,30.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.data ?? ''))) bledy.data = 'Podaj datę odczytu.';
  const wiersze = wierszePradu(s.dane, s.indeksy, k).filter((x) => x.status !== 'rozliczony');
  const doZapisu = [];
  for (const x of wiersze) {
    const tekst = String(w[`kwh_${x.jednostka.id}`] ?? '').trim();
    if (!tekst) continue;
    const kwh = czytajKwh(tekst);
    if (kwh == null) { bledy[`kwh_${x.jednostka.id}`] = 'liczba'; continue; }
    const poprzedni = poprzedniOdczyt((s.dane.power_readings ?? []).filter((o) => o.unit_id === x.jednostka.id), x.najem);
    if (poprzedni && x.najem && kwh < Number(poprzedni.kwh)) { bledy[`kwh_${x.jednostka.id}`] = 'mniej niż poprzednio'; continue; }
    doZapisu.push({ ...x, kwh, poprzedni });
  }
  if (!Object.keys(bledy).length && !doZapisu.length) bledy.data = 'Wpisz stan licznika przy co najmniej jednej jednostce.';
  if (Object.keys(bledy).some((b) => b.startsWith('kwh_'))) {
    s.ui.form.blad = `Popraw odczyty: ${Object.entries(bledy).filter(([b]) => b.startsWith('kwh_'))
      .map(([b, t]) => `${s.indeksy.jednostki.get(b.slice(4))?.code ?? '?'} – ${t}`).join(', ')}.`;
  }
  if (maBledy(ctx, w, bledy)) return;
  if (bezPolaczenia(s)) { s.ui.form.blad = 'Zapis wymaga połączenia z bazą.'; ctx.render(); return; }
  await zapisz(ctx, async () => {
    if (cena !== cenaGr(s)) ctx.scal({ settings: await ctx.db.zapiszUstawienia(s.uzytkownik.id, { power_price_gr: cena }) });
    let suma = 0;
    let liczba = 0;
    for (const x of doZapisu) {
      let korekta = null;
      let kwota = null;
      if (x.najem && x.poprzedni) {
        const zuzycie = Math.round((x.kwh - Number(x.poprzedni.kwh)) * 10) / 10;
        kwota = kwotaZaPrad(zuzycie, cena);
        const miesiac = x.najem.end_on && x.najem.end_on < w.miesiac ? `${x.najem.end_on.slice(0, 7)}-01` : w.miesiac;
        if (kwota > 0) {
          korekta = await ctx.db.wstaw('charge_adjustments', {
            rental_id: x.najem.id, period_start: miesiac, amount_gr: kwota, reason: powodOplaty(k, Number(x.poprzedni.kwh), x.kwh, cena),
          });
          ctx.scal({ charge_adjustments: [korekta] });
        }
        suma += kwota;
      }
      const odczyt = await ctx.db.wstaw('power_readings', {
        unit_id: x.jednostka.id, rental_id: x.najem?.id ?? null, read_on: w.data, kwh: x.kwh,
        amount_gr: kwota, adjustment_id: korekta?.id ?? null,
      });
      ctx.scal({ power_readings: [odczyt] });
      liczba += 1;
    }
    s.ui.form = null;
    ctx.toast(`Zapisano ${liczba} odczyt(y)${suma ? ` · doliczono razem ${formatZl(suma)}` : ''}`);
    ctx.render();
  });
}

async function usunOdczyt(el, ctx) {
  const s = ctx.state;
  const o = (s.dane.power_readings ?? []).find((x) => x.id === el.dataset.id);
  s.ui.usunOdczyt = null;
  if (!o) return;
  if (bezPolaczenia(s)) { ctx.toast('Usuwanie wymaga połączenia z bazą.'); return; }
  try {
    await ctx.db.usun('power_readings', o.id);
    if (o.adjustment_id) await ctx.db.usun('charge_adjustments', o.adjustment_id);
    s.dane = { ...s.dane, power_readings: s.dane.power_readings.filter((x) => x.id !== o.id),
      charge_adjustments: s.dane.charge_adjustments.filter((x) => x.id !== o.adjustment_id) };
    ctx.scal({});
    ctx.toast('Usunięto odczyt');
    ctx.render();
  } catch (e) {
    ctx.toast(e.message);
  }
}

export default {
  zakladka: 'jednostki',
  tytul: (s) => `Prąd – ${wybranyKwartal(s).nazwa}`,
  wstecz: () => ({ href: '#/jednostki', tekst: 'Jednostki' }),
  render,
  akcje: {
    'usun-odczyt'(el, ctx) { ctx.state.ui.usunOdczyt = el.dataset.id; ctx.render(); },
    'usun-odczyt-nie'(_el, ctx) { ctx.state.ui.usunOdczyt = null; ctx.render(); },
    'usun-odczyt-tak': usunOdczyt,
  },
  formularze: { 'odczyty-pradu': zapiszOdczyty },
};
