// Rozliczenia (5.3–5.4): wpłaty pokrywają należności od najstarszej, saldo, zaległość, dłużnicy.
// Czyste funkcje. Wynik dla wszystkich klientów liczony raz na dany stan danych (pamięć podręczna).

import { wszystkieNaleznosci } from './okresy.js';
import { roznicaDni } from './utils.js';

/**
 * Rozliczenie jednego klienta.
 * @param {object} k
 * @param {Array} k.naleznosci należności jego najmów (okresy.naleznosciNajmu), z polem kod (numer jednostki)
 * @param {Array} k.wplaty wpłaty kind = 'czynsz' tego klienta
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
    .map((w) => ({ data: w.booked_on, kwota: w.amount_gr }));
  if (saldoOtwarcia > 0) ruchy.unshift({ data: dataStart, kwota: saldoOtwarcia });

  let nadwyzka = 0;   // wpłacone, a jeszcze niczego nie pokrywa (brak dalszych należności)
  for (const r of ruchy) {
    if (r.kwota >= 0) {
      let zostalo = r.kwota;
      for (const p of pozycje) {
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
