// Prąd – rozliczenie kwartalne (prośba 12.11.2026). Jednostki z prądem (units.has_power) mają licznik;
// co kwartał wpisuje się stany liczników, a aplikacja dolicza klientowi zużycie × cena 1 kWh
// (settings.power_price_gr, domyślnie 1,30 zł brutto) jako zmianę kwoty w wybranym miesiącu (charge_adjustments).
// Odczyty: tabela power_readings (migracja 017). Pierwszy odczyt w najmie (np. stan z umowy przy wydaniu) – bez opłaty.
// Czyste funkcje (bez bazy i DOM).

import { najemTrwa } from './dane.js';
import { dodajDni, dodajMiesiace, iso, parseData } from './utils.js';

export const RZYMSKIE = ['I', 'II', 'III', 'IV'];

/** Kwartał dnia: { rok, numer, od, do, klucz: '2026-4', nazwa: 'IV kw. 2026' }. */
export function kwartal(dzien) {
  const p = parseData(dzien);
  return kwartalNr(p.y, Math.floor((p.m - 1) / 3) + 1);
}

/** Kwartał po roku i numerze (1–4). */
export function kwartalNr(rok, numer) {
  const od = iso(rok, (numer - 1) * 3 + 1, 1);
  return { rok, numer, od, do: dodajDni(dodajMiesiace(od, 3), -1), klucz: `${rok}-${numer}`, nazwa: `${RZYMSKIE[numer - 1]} kw. ${rok}` };
}

/** Poprzedni kwartał. */
export const poprzedniKwartal = (k) => (k.numer === 1 ? kwartalNr(k.rok - 1, 4) : kwartalNr(k.rok, k.numer - 1));

/** Kwartał do rozliczenia w dniu: do 30. dnia po końcu kwartału – poprzedni, potem bieżący. */
export function kwartalDoRozliczenia(dzien) {
  const k = kwartal(dzien);
  return dzien <= dodajDni(k.od, 29) ? poprzedniKwartal(k) : k;
}

/** „1 234,5” → 1234.5; null, gdy to nie liczba ≥ 0 (maks. jedno miejsce po przecinku). */
export function czytajKwh(tekst) {
  const t = String(tekst ?? '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d)?$/.test(t)) return null;
  return Number(t);
}

/** 1234.5 → „1 234,5”. */
export const formatKwh = (x) => (x == null ? '—' : Number(x).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 1 }));

/** Kwota za zużycie: kWh × cena (gr), do pełnego grosza. */
export const kwotaZaPrad = (kwh, cenaGr) => Math.round(kwh * cenaGr);

/** Najem jednostki do rozliczenia kwartału: trwający w dniu końca kwartału albo ostatni, który zaczął się przed jego końcem. */
export function najemDoRozliczenia(najmyJednostki = [], k) {
  const wKwartale = najmyJednostki.filter((n) => n.start_on <= k.do && (n.end_on == null || n.end_on >= k.od))
    .sort((a, b) => b.start_on.localeCompare(a.start_on));
  return wKwartale.find((n) => najemTrwa(n, k.do)) ?? wKwartale[0] ?? null;
}

/**
 * Poprzedni odczyt dla najmu: ostatni odczyt tego najmu; gdy go nie ma – odczyt jednostki bez najmu
 * z 14 dni przed startem albo później (stan przy wydaniu).
 */
export function poprzedniOdczyt(odczytyJednostki = [], najem, przed = '9999-12-31') {
  const posortowane = [...odczytyJednostki].filter((o) => o.read_on <= przed)
    .sort((a, b) => a.read_on.localeCompare(b.read_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  if (!najem) return posortowane.at(-1) ?? null;
  const tegoNajmu = posortowane.filter((o) => o.rental_id === najem.id);
  if (tegoNajmu.length) return tegoNajmu.at(-1);
  return posortowane.filter((o) => !o.rental_id && o.read_on >= dodajDni(najem.start_on, -14)).at(-1) ?? null;
}

/**
 * Wiersze ekranu „Prąd” dla kwartału: każda jednostka z prądem.
 * @returns {Array<{ jednostka, najem, klient, poprzedni, odczytKwartalu, status }>}
 *   status: 'rozliczony' (jest odczyt z okolic końca kwartału), 'poczatkowy' (najem bez odczytu – pierwszy będzie bez opłaty),
 *   'do-odczytu', 'wolna' (bez najmu)
 */
export function wierszePradu(dane, indeksy, k) {
  const jednostki = dane.units.filter((u) => u.has_power && !u.archived)
    .sort((a, b) => a.code.localeCompare(b.code, 'pl', { numeric: true }));
  const odczyty = dane.power_readings ?? [];
  const odDnia = dodajDni(k.do, -20);
  const doDnia = dodajDni(k.do, 30);
  return jednostki.map((j) => {
    const zJednostki = odczyty.filter((o) => o.unit_id === j.id);
    const najem = najemDoRozliczenia(indeksy.najmyJednostki.get(j.id) ?? [], k);
    const umowa = najem ? indeksy.umowy.get(najem.contract_id) : null;
    const klient = umowa ? indeksy.klienci.get(umowa.client_id) ?? null : null;
    const odczytKwartalu = zJednostki.filter((o) => (!najem || o.rental_id === najem.id) && o.read_on >= odDnia && o.read_on <= doDnia
      && o.amount_gr != null).sort((a, b) => b.read_on.localeCompare(a.read_on))[0] ?? null;
    const poprzedni = poprzedniOdczyt(zJednostki.filter((o) => o !== odczytKwartalu), najem);
    let status = 'do-odczytu';
    if (!najem) status = 'wolna';
    else if (odczytKwartalu) status = 'rozliczony';
    else if (!poprzedni) status = 'poczatkowy';
    return { jednostka: j, najem, klient, poprzedni, odczytKwartalu, status };
  });
}

/** Miesiąc doliczenia opłaty: 1. dzień miesiąca po kwartale; gdy najem kończy się wcześniej – miesiąc końca najmu. */
export function miesiacDoliczenia(k, najem) {
  const po = dodajMiesiace(k.od, 3);
  if (najem?.end_on && najem.end_on < po) return `${najem.end_on.slice(0, 7)}-01`;
  return po;
}

/** Powód zmiany kwoty: „Prąd IV kw. 2026: 1 200 → 1 320,5 kWh = 120,5 kWh × 1,30 zł”. */
export function powodOplaty(k, poprzedniKwh, kwh, cenaGr) {
  const cena = (cenaGr / 100).toFixed(2).replace('.', ',');
  return `Prąd ${k.nazwa}: ${formatKwh(poprzedniKwh)} → ${formatKwh(kwh)} kWh = ${formatKwh(Math.round((kwh - poprzedniKwh) * 10) / 10)} kWh × ${cena} zł`;
}

/** Ile jednostek z najmem czeka na odczyt za kwartał (pasek na Pulpicie). */
export function doRozliczenia(dane, indeksy, k) {
  return wierszePradu(dane, indeksy, k).filter((w) => w.status === 'do-odczytu' || w.status === 'poczatkowy');
}
