// Rozliczenia (5.3–5.4): wpłaty pokrywają należności od najstarszej, saldo, zaległość, dłużnicy.
// Czyste funkcje. Wynik dla wszystkich klientów liczony raz na dany stan danych (pamięć podręczna).

import { wszystkieNaleznosci } from './okresy.js';
import { roznicaDni } from './utils.js';

/**
 * Rozliczenie jednego klienta.
 * @param {object} k
 * @param {Array} k.naleznosci należności jego najmów (okresy.naleznosciNajmu), z polem kod (numer jednostki)
 * @param {Array} k.wplaty wpłaty kind = 'czynsz' tego klienta; rental_id = wpłata przypisana ręcznie do jednostki
 *   (najpierw pokrywa należności tego najmu od najstarszej, reszta – pozostałe jak zwykle)
 * @param {number} k.saldoOtwarcia clients.opening_balance_gr (ujemne = zaległość)
 * @param {string} k.dataStart, k.dzis RRRR-MM-DD
 * @param {number} k.tolerancja dni (settings.tolerance_days)
 */
export function rozliczKlienta({ naleznosci, wplaty, saldoOtwarcia = 0, dataStart, dzis, tolerancja = 0 }) {
  const pozycje = naleznosci.map((n) => ({ ...n, zaplaconoGr: 0, zaplaconoDnia: null }));
  if (saldoOtwarcia < 0) {
    pozycje.push({ otwarcie: true, termin: dataStart, poczatek: dataStart, koniec: dataStart, kod: '',
      kwotaGr: -saldoOtwarcia, zaplaconoGr: 0, zaplaconoDnia: null });
  }
  // Saldo otwarcia przed należnościami z tym samym terminem; potem termin, numer jednostki.
  pozycje.sort((a, b) => a.termin.localeCompare(b.termin) || (b.otwarcie ? 1 : 0) - (a.otwarcie ? 1 : 0)
    || String(a.kod).localeCompare(String(b.kod), 'pl', { numeric: true }));

  const ruchy = [...wplaty]
    .sort((a, b) => a.booked_on.localeCompare(b.booked_on) || String(a.created_at).localeCompare(String(b.created_at)))
    .map((w) => ({ data: w.booked_on, kwota: w.amount_gr, najemId: w.rental_id ?? null }));
  if (saldoOtwarcia > 0) ruchy.unshift({ data: dataStart, kwota: saldoOtwarcia });

  let nadwyzka = 0;   // wpłacone, a jeszcze niczego nie pokrywa (brak dalszych należności)
  for (const r of ruchy) {
    if (r.kwota >= 0) {
      let zostalo = r.kwota;
      const kolejnosc = r.najemId && pozycje.some((p) => p.najemId === r.najemId)
        ? [...pozycje.filter((p) => p.najemId === r.najemId), ...pozycje.filter((p) => p.najemId !== r.najemId)]
        : pozycje;
      for (const p of kolejnosc) {
        if (!zostalo) break;
        const brak = p.kwotaGr - p.zaplaconoGr;
        if (brak <= 0) continue;
        const ile = Math.min(brak, zostalo);
        p.zaplaconoGr += ile;
        zostalo -= ile;
        if (p.zaplaconoGr === p.kwotaGr) p.zaplaconoDnia = r.data;
      }
      nadwyzka += zostalo;
    } else {
      // Zwrot nadpłaty: najpierw z nadwyżki, potem zdejmuje pokrycie od najnowszej pokrytej należności.
      let zdjac = -r.kwota;
      const zNadwyzki = Math.min(nadwyzka, zdjac);
      nadwyzka -= zNadwyzki;
      zdjac -= zNadwyzki;
      for (let i = pozycje.length - 1; i >= 0 && zdjac > 0; i--) {
        const p = pozycje[i];
        const ile = Math.min(p.zaplaconoGr, zdjac);
        p.zaplaconoGr -= ile;
        zdjac -= ile;
        if (ile) p.zaplaconoDnia = null;
      }
    }
  }

  for (const p of pozycje) {
    if (p.zaplaconoGr >= p.kwotaGr) p.status = 'oplacona';
    else if (p.termin > dzis) p.status = 'przyszla';
    else p.status = p.zaplaconoGr ? 'czesciowo' : 'nieoplacona';
  }

  const sumaWplat = ruchy.reduce((s, r) => s + r.kwota, 0);
  const wymagalne = pozycje.filter((p) => p.termin <= dzis);
  const saldoGr = sumaWplat - wymagalne.reduce((s, p) => s + p.kwotaGr, 0);
  const zalegle = pozycje.filter((p) => p.termin < dzis && p.zaplaconoGr < p.kwotaGr);
  const zalegloscGr = zalegle.reduce((s, p) => s + p.kwotaGr - p.zaplaconoGr, 0);
  const dniPoTerminie = zalegle.length ? roznicaDni(zalegle[0].termin, dzis) : 0;

  // Opłacone do: koniec ostatniego okresu pokrytego w całości, licząc od początku najmu bez przerw.
  const oplaconeDo = new Map();
  const przerwane = new Set();
  for (const p of pozycje) {
    if (p.otwarcie || przerwane.has(p.najemId)) continue;
    if (p.zaplaconoGr === p.kwotaGr) oplaconeDo.set(p.najemId, p.koniec);
    else przerwane.add(p.najemId);
  }

  return {
    pozycje,
    saldoGr,
    zalegloscGr,
    dniPoTerminie,
    dluznik: zalegloscGr > 0 && dniPoTerminie > tolerancja,
    oplaconeDo,
    ostatniaWplata: wplaty.reduce((m, w) => (w.amount_gr > 0 && (!m || w.booked_on > m) ? w.booked_on : m), null),
  };
}

const pamiec = new WeakMap();

/**
 * Rozliczenia wszystkich klientów: Map(clientId → wynik rozliczKlienta).
 * Liczone raz dla danego obiektu danych (state.dane podmienia się przy każdej zmianie).
 */
export function rozliczenia(dane, { dataStart, dzis, tolerancja = 0 }) {
  const klucz = `${dataStart}|${dzis}|${tolerancja}`;
  const zapisane = pamiec.get(dane);
  if (zapisane?.klucz === klucz) return zapisane.wynik;

  const umowy = new Map(dane.contracts.map((u) => [u.id, u]));
  const najmy = new Map(dane.rentals.map((n) => [n.id, n]));
  const kody = new Map(dane.units.map((j) => [j.id, j.code]));
  const naleznosci = new Map();
  for (const n of wszystkieNaleznosci(dane, { dataStart, dzis })) {
    const klientId = umowy.get(najmy.get(n.najemId)?.contract_id)?.client_id;
    if (!klientId) continue;
    if (!naleznosci.has(klientId)) naleznosci.set(klientId, []);
    naleznosci.get(klientId).push({ ...n, kod: kody.get(n.jednostkaId) ?? '' });
  }
  const wplaty = new Map();
  for (const w of dane.payments) {
    if (w.kind !== 'czynsz' || !w.client_id) continue;
    if (!wplaty.has(w.client_id)) wplaty.set(w.client_id, []);
    wplaty.get(w.client_id).push(w);
  }
  const wynik = new Map(dane.clients.map((k) => [k.id, rozliczKlienta({
    naleznosci: naleznosci.get(k.id) ?? [], wplaty: wplaty.get(k.id) ?? [],
    saldoOtwarcia: k.opening_balance_gr ?? 0, dataStart, dzis, tolerancja,
  })]));
  pamiec.set(dane, { klucz, wynik });
  return wynik;
}

// ---------------------------------------------------------------------
// Kartoteka rozrachunków (8.5)
// ---------------------------------------------------------------------

const OPIS_WPLATY = { przelew: 'Wpłata przelewem', gotowka: 'Wpłata gotówką', kaucja: 'Pokrycie z kaucji' };

/**
 * Pozycje kartoteki od najstarszej: należności z terminem do dziś (Winien) i wpłaty czynszowe (Ma),
 * z saldem narastająco. Przy tej samej dacie najpierw należność, potem wpłata.
 * @returns {Array<{data, opis, winienGr, maGr, saldoGr}>}
 */
export function kartoteka({ pozycje, wplaty, saldoOtwarcia = 0, dataStart, dzis }) {
  const wiersze = [];
  if (saldoOtwarcia) {
    wiersze.push({ data: dataStart, kolej: 0, opis: 'Saldo otwarcia',
      winienGr: saldoOtwarcia < 0 ? -saldoOtwarcia : 0, maGr: saldoOtwarcia > 0 ? saldoOtwarcia : 0 });
  }
  for (const p of pozycje) {
    if (p.otwarcie || p.termin > dzis) continue;
    const okres = `${p.poczatek.slice(8, 10)}.${p.poczatek.slice(5, 7)}–${p.koniec.slice(8, 10)}.${p.koniec.slice(5, 7)}`;
    wiersze.push({ data: p.termin, kolej: 1, opis: `Należność ${p.kod} za ${okres}`, winienGr: p.kwotaGr, maGr: 0 });
  }
  for (const w of wplaty) {
    if (w.booked_on > dzis) continue;
    const rodzaj = w.amount_gr < 0 ? 'Zwrot nadpłaty' : OPIS_WPLATY[w.method] ?? 'Wpłata';
    const kod = w.rental_id ? pozycje.find((p) => p.najemId === w.rental_id)?.kod : null;
    const opis = kod ? `${rodzaj} za ${kod}` : rodzaj;
    wiersze.push({ data: w.booked_on, kolej: 2, opis: w.title ? `${opis} · ${w.title}` : opis,
      winienGr: w.amount_gr < 0 ? -w.amount_gr : 0, maGr: w.amount_gr > 0 ? w.amount_gr : 0 });
  }
  wiersze.sort((a, b) => a.data.localeCompare(b.data) || a.kolej - b.kolej);
  let saldo = 0;
  return wiersze.map(({ kolej, ...w }) => {
    saldo += w.maGr - w.winienGr;
    return { ...w, saldoGr: saldo };
  });
}

// ---------------------------------------------------------------------
// Terminowość (5.5)
// ---------------------------------------------------------------------

/**
 * @param {Array} pozycje wynik rozliczKlienta().pozycje
 * @param {{dzis, tolerancja, miesiecy, progi}} o progi = PROGI_TERMINOWOSCI z config.js
 * @returns {{ miesiace: [{klucz, stan:'brak'|'ok'|'spoznienie'|'brak-zaplaty'|'czeka', dni}], procent, srednieOpoznienie,
 *   liczba, etykieta }}
 */
export function terminowosc(pozycje, { dzis, tolerancja = 0, miesiecy = 12, progi }) {
  const [y, m] = dzis.split('-').map(Number);
  const klucze = [];
  for (let i = miesiecy - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    klucze.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const od = `${klucze[0]}-01`;
  const oceny = [];
  for (const p of pozycje) {
    if (p.otwarcie || p.termin < od || p.termin > dzis || !p.kwotaGr) continue;
    const granica = roznicaDni(p.termin, dzis);
    const zaplacona = p.zaplaconoGr >= p.kwotaGr && p.zaplaconoDnia;
    if (!zaplacona && granica <= tolerancja) { oceny.push({ p, stan: 'czeka' }); continue; }
    const opoznienie = zaplacona ? Math.max(0, roznicaDni(p.termin, p.zaplaconoDnia)) : granica;
    if (zaplacona && opoznienie <= tolerancja) oceny.push({ p, stan: 'ok', dni: 0 });
    else oceny.push({ p, stan: zaplacona ? 'spoznienie' : 'brak-zaplaty', dni: opoznienie });
  }

  const miesiace = klucze.map((klucz) => {
    const w = oceny.filter((o) => o.p.termin.startsWith(klucz));
    const dni = Math.max(0, ...w.map((o) => o.dni ?? 0));
    let stan = 'brak';
    if (w.some((o) => o.stan === 'brak-zaplaty')) stan = 'brak-zaplaty';
    else if (w.some((o) => o.stan === 'spoznienie')) stan = 'spoznienie';
    else if (w.some((o) => o.stan === 'ok')) stan = 'ok';
    else if (w.length) stan = 'czeka';
    return { klucz, stan, dni };
  });

  const ocenione = oceny.filter((o) => o.stan !== 'czeka');
  const terminowe = ocenione.filter((o) => o.stan === 'ok').length;
  const spoznione = ocenione.filter((o) => o.stan !== 'ok');
  const procent = ocenione.length ? terminowe / ocenione.length : null;
  let etykieta = 'Za mało danych';
  if (ocenione.length >= progi.minNaleznosci) {
    if (procent === 1 && ocenione.length >= progi.wzorowyMinNaleznosci) etykieta = 'Wzorowy';
    else if (procent >= progi.terminowy) etykieta = 'Terminowy';
    else if (procent >= progi.zdarzaSie) etykieta = 'Zdarza się spóźnić';
    else etykieta = 'Spóźnia się';
  }
  return {
    miesiace,
    procent,
    liczba: ocenione.length,
    srednieOpoznienie: spoznione.length ? Math.round(spoznione.reduce((x, o) => x + o.dni, 0) / spoznione.length) : 0,
    etykieta,
  };
}
