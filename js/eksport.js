// Eksporty CSV dla Excela i księgowej (rozdz. 10): klienci, jednostki, wpłaty, dłużnicy, koszty (0.16.0).
// Czyste funkcje: dane + ustawienia → { naglowek, wiersze }. Plik składa csv.doCsv (średnik, UTF-8 z BOM).
// Kwoty w złotych z przecinkiem dziesiętnym, daty RRRR-MM-DD (rozdz. 10).

import { PROGI_TERMINOWOSCI, TYPY_JEDNOSTEK } from './config.js';
import { biezacyNajem, najemZakonczony, stawkaNaDzien } from './dane.js';
import { rozliczenia, terminowosc } from './rozliczenia.js';
import { nazwaKategorii } from './koszty.js';
import { porownajKody, roznicaDni } from './utils.js';

export const zlCsv = (gr) => (gr == null ? '' : (gr / 100).toFixed(2).replace('.', ','));
const procentCsv = (x) => (x == null ? '' : String(Math.round(x * 100)));
const BANKI_CSV = { nest: 'Nest Bank', pekao: 'Pekao', pko: 'PKO BP', alior: 'Alior', millennium: 'Millennium', inny: 'Inny' };
const RODZAJE = { czynsz: 'czynsz', kaucja: 'kaucja', przychod_inny: 'przychód inny', pominieta: 'pominięta' };
const FORMY = { przelew: 'przelew', gotowka: 'gotówka', kaucja: 'z kaucji' };

/** Indeksy potrzebne eksportom (bez zależności od state.indeksy). */
function indeksy(dane) {
  const grupuj = (lista, klucz) => {
    const m = new Map();
    for (const x of lista) m.set(x[klucz], [...(m.get(x[klucz]) ?? []), x]);
    return m;
  };
  const umowy = new Map(dane.contracts.map((u) => [u.id, u]));
  const najmyKlienta = new Map();
  for (const n of dane.rentals) {
    const k = umowy.get(n.contract_id)?.client_id;
    if (k) najmyKlienta.set(k, [...(najmyKlienta.get(k) ?? []), n]);
  }
  return {
    umowy, najmyKlienta,
    klienci: new Map(dane.clients.map((k) => [k.id, k])),
    jednostki: new Map(dane.units.map((j) => [j.id, j])),
    konta: new Map(dane.bank_accounts.map((k) => [k.id, k])),
    najmyJednostki: grupuj(dane.rentals, 'unit_id'),
    stawkiNajmu: grupuj(dane.rental_rates, 'rental_id'),
  };
}

const rozl = (dane, dzis, u) => rozliczenia(dane, { dataStart: u.data_start, dzis, tolerancja: u.tolerance_days });

/** Klienci: dane, aktywne jednostki, saldo, zaległość, terminowość. */
export function eksportKlientow(dane, { dzis, ustawienia: u }) {
  const ix = indeksy(dane);
  const r = rozl(dane, dzis, u);
  const naglowek = ['nazwa', 'rodzaj', 'osoba_kontaktowa', 'nip', 'adres', 'telefon', 'email', 'jednostki', 'saldo',
    'zaleglosc', 'dni_po_terminie', 'terminowosc_proc', 'terminowosc', 'ostatnia_wplata', 'zarchiwizowany'];
  const wiersze = [...dane.clients].sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((k) => {
    const wynik = r.get(k.id);
    const kody = (ix.najmyKlienta.get(k.id) ?? []).filter((n) => !najemZakonczony(n, dzis))
      .map((n) => ix.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
    const t = wynik ? terminowosc(wynik.pozycje, { dzis, tolerancja: u.tolerance_days, miesiecy: u.punctuality_months ?? 12,
      progi: PROGI_TERMINOWOSCI }) : null;
    return [k.name, k.kind, k.contact_person ?? '', k.nip ?? '', k.address ?? '', k.phone ?? '', k.email ?? '', kody.join(', '),
      zlCsv(wynik?.saldoGr ?? 0), zlCsv(wynik?.zalegloscGr ?? 0), wynik?.zalegloscGr ? wynik.dniPoTerminie : '',
      procentCsv(t?.procent), t?.etykieta ?? '', wynik?.ostatniaWplata ?? '', k.archived ? 'tak' : ''];
  });
  return { naglowek, wiersze };
}

/** Jednostki: status, bieżący klient, stawka. */
export function eksportJednostek(dane, { dzis, ustawienia: u }) {
  const ix = indeksy(dane);
  const r = rozl(dane, dzis, u);
  const naglowek = ['numer', 'typ', 'powierzchnia_m2', 'cena_cennik', 'status', 'klient', 'najem_od', 'stawka', 'zaleglosc_najmu',
    'oplacone_do', 'umowa_do'];
  const wiersze = dane.units.filter((j) => !j.archived).sort((a, b) => porownajKody(a.code, b.code)).map((j) => {
    const najem = biezacyNajem(ix.najmyJednostki.get(j.id), dzis);
    const umowa = najem && ix.umowy.get(najem.contract_id);
    const klient = umowa && ix.klienci.get(umowa.client_id);
    const wynik = klient && r.get(klient.id);
    const zaleglosc = najem && wynik ? wynik.pozycje.filter((p) => p.najemId === najem.id && p.termin < dzis)
      .reduce((x, p) => x + p.kwotaGr - p.zaplaconoGr, 0) : 0;
    let status = 'wolna';
    if (j.out_of_service) status = 'wyłączona';
    else if (najem) status = zaleglosc > 0 ? 'zalega' : 'opłacona';
    return [j.code, TYPY_JEDNOSTEK[j.type]?.nazwa ?? j.type, j.area_m2 == null ? '' : String(j.area_m2).replace('.', ','),
      zlCsv(j.list_price_gr), status, klient?.name ?? '', najem?.start_on ?? '',
      najem ? zlCsv(stawkaNaDzien(ix.stawkiNajmu.get(najem.id), dzis)) : '', najem ? zlCsv(zaleglosc) : '',
      (najem && wynik?.oplaconeDo.get(najem.id)) ?? '', umowa?.valid_until ?? ''];
  });
  return { naglowek, wiersze };
}

/** Wpłaty z zakresu dat (od, do włącznie) z klientem, kontem i formą. */
export function eksportWplat(dane, { od = '0000-01-01', do: doDnia = '9999-12-31' } = {}) {
  const ix = indeksy(dane);
  const naglowek = ['data', 'kwota', 'rodzaj', 'forma', 'klient', 'konto', 'nadawca', 'rachunek_nadawcy', 'tytul', 'notatka'];
  const wiersze = dane.payments.filter((w) => w.booked_on >= od && w.booked_on <= doDnia)
    .sort((a, b) => a.booked_on.localeCompare(b.booked_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map((w) => {
      const konto = w.bank_account_id ? ix.konta.get(w.bank_account_id) : null;
      return [w.booked_on, zlCsv(w.amount_gr), RODZAJE[w.kind] ?? w.kind, FORMY[w.method] ?? w.method,
        w.client_id ? (ix.klienci.get(w.client_id)?.name ?? '') : (w.kind === 'czynsz' ? 'do przypisania' : ''),
        konto ? `${konto.name} (${BANKI_CSV[konto.bank] ?? konto.bank})` : '', w.counterparty ?? '', w.payer_account ?? '',
        w.title ?? '', w.note ?? ''];
    });
  return { naglowek, wiersze };
}

/** Koszty (etap 2) w zakresie dat, od najstarszego; pominięte wypływy (nie koszt) tylko gdy pominiete = true. */
export function eksportKosztow(dane, { od = '0000-01-01', do: doDnia = '9999-12-31', pominiete = false } = {}) {
  const ix = indeksy(dane);
  const jednostki = new Map((dane.units ?? []).map((j) => [j.id, j]));
  const naglowek = ['data', 'kwota', 'kategoria', 'jednostka', 'zrodlo', 'konto', 'odbiorca', 'tytul', 'notatka'];
  const wiersze = (dane.expenses ?? [])
    .filter((e) => e.spent_on >= od && e.spent_on <= doDnia && (pominiete || e.category !== 'pominiety'))
    .sort((a, b) => a.spent_on.localeCompare(b.spent_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map((e) => {
      const konto = e.bank_account_id ? ix.konta.get(e.bank_account_id) : null;
      return [e.spent_on, zlCsv(e.amount_gr), nazwaKategorii(e.category), e.unit_id ? (jednostki.get(e.unit_id)?.code ?? '') : 'wspólny',
        e.source === 'import' ? 'wyciąg' : 'ręcznie', konto ? `${konto.name} (${BANKI_CSV[konto.bank] ?? konto.bank})` : '',
        e.counterparty ?? '', e.title ?? '', e.note ?? ''];
    });
  return { naglowek, wiersze };
}

/** Dłużnicy: zaległość, dni po terminie, wiekowanie, kontakt, ostatnia obietnica zapłaty. */
export function eksportDluznikow(dane, { dzis, ustawienia: u }) {
  const ix = indeksy(dane);
  const r = rozl(dane, dzis, u);
  const naglowek = ['klient', 'jednostki', 'zaleglosc', 'dni_po_terminie', 'do_30_dni', 'od_31_do_60', 'od_61_do_90', 'ponad_90',
    'telefon', 'email', 'obietnica_do', 'obietnica_kwota'];
  const wiersze = [...r.entries()].filter(([id, w]) => w.dluznik && !ix.klienci.get(id)?.archived)
    .sort((a, b) => b[1].zalegloscGr - a[1].zalegloscGr).map(([id, w]) => {
      const k = ix.klienci.get(id);
      const kosze = [0, 0, 0, 0];
      for (const p of w.pozycje) {
        if (p.termin >= dzis || p.zaplaconoGr >= p.kwotaGr) continue;
        const dni = roznicaDni(p.termin, dzis);
        kosze[dni <= 30 ? 0 : dni <= 60 ? 1 : dni <= 90 ? 2 : 3] += p.kwotaGr - p.zaplaconoGr;
      }
      const obietnica = dane.client_notes.filter((n) => n.client_id === id && n.kind === 'obietnica' && n.promised_on)
        .sort((a, b) => b.promised_on.localeCompare(a.promised_on))[0];
      const kody = (ix.najmyKlienta.get(id) ?? []).filter((n) => !najemZakonczony(n, dzis))
        .map((n) => ix.jednostki.get(n.unit_id)?.code).filter(Boolean).sort(porownajKody);
      return [k?.name ?? '', kody.join(', '), zlCsv(w.zalegloscGr), w.dniPoTerminie, ...kosze.map(zlCsv), k?.phone ?? '',
        k?.email ?? '', obietnica?.promised_on ?? '', obietnica?.promised_gr ? zlCsv(obietnica.promised_gr) : ''];
    });
  return { naglowek, wiersze };
}
