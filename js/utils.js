// Czyste funkcje pomocnicze: kwoty w groszach, daty bez godziny, tekst.
// Bez dostępu do DOM i bazy – testowane w tests/utils.test.js (node --test).

export const STREFA = 'Europe/Warsaw';
const NBSP = '\u00A0';   // twarda spacja
const MINUS = '\u2212';  // znak minus (nie dywiz)

// ---------------------------------------------------------------------
// Kwoty (Z37: liczby całkowite w groszach)
// ---------------------------------------------------------------------

/** Grupuje cyfry po 3 twardą spacją: 4996 → "4 996" (Intl dla pl-PL nie grupuje liczb 4-cyfrowych). */
function grupuj(cyfry) {
  return cyfry.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * Formatuje kwotę w groszach.
 * formatZl(33000) → "330,00 zł"; formatZl(499600, { grosze: false }) → "4 996 zł"; formatZl(-1250) → "−12,50 zł"
 */
export function formatZl(gr, { grosze = true, waluta = true } = {}) {
  if (gr == null || !Number.isFinite(gr)) return '—';
  const ujemna = gr < 0;
  const abs = Math.abs(Math.round(gr));
  let tekst;
  if (grosze) {
    tekst = `${grupuj(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`;
  } else {
    tekst = grupuj(String(Math.round(abs / 100)));
  }
  if (ujemna && tekst.replace(/[^1-9]/g, '') !== '') tekst = MINUS + tekst;
  return waluta ? `${tekst}${NBSP}zł` : tekst;
}

/** Stawka w punktach bazowych jako procent: 850 → "8,5%", 1250 → "12,5%". */
export function formatProcentBp(bp) {
  if (bp == null || !Number.isFinite(bp)) return '—';
  return `${String(bp / 100).replace('.', ',')}%`;
}

/** Powierzchnia: "12.50" (numeric z bazy) → "12,5 m²"; null → "". */
export function formatM2(wartosc) {
  const n = Number(wartosc);
  if (wartosc == null || wartosc === '' || !Number.isFinite(n)) return '';
  return `${String(Math.round(n * 100) / 100).replace('.', ',')}${NBSP}m²`;
}

/**
 * Zamienia tekst kwoty na grosze. Zwraca null, gdy tekst nie jest kwotą.
 * Obsługuje: "1 234,56", "1234.56", "-12,5", "1.234,56", "1,234.56", "300 zł", "−12,50".
 */
export function parseKwota(wartosc) {
  if (wartosc == null) return null;
  if (typeof wartosc === 'number') return Number.isFinite(wartosc) ? Math.round(wartosc * 100) : null;

  let s = String(wartosc).trim().replace(/[\s\u00A0\u202F']/g, '').replace(/(zł|zl|pln)$/i, '');
  s = s.replace(/^[\u2212\u2013]/, '-');
  let znak = 1;
  if (s.startsWith('-')) { znak = -1; s = s.slice(1); } else if (s.startsWith('+')) { s = s.slice(1); }

  // Separator dziesiętny to ostatni z dwóch rodzajów; drugi rodzaj to separator tysięcy.
  // Jeden rodzaj występujący wielokrotnie to separator tysięcy (1.234.567).
  const przecinki = (s.match(/,/g) || []).length;
  const kropki = (s.match(/\./g) || []).length;
  let dziesietny = null;
  let tysiace = null;
  if (przecinki && kropki) {
    dziesietny = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    tysiace = dziesietny === ',' ? '.' : ',';
  } else if (przecinki === 1 || kropki === 1) {
    dziesietny = przecinki ? ',' : '.';
  } else if (przecinki > 1 || kropki > 1) {
    tysiace = przecinki ? ',' : '.';
  }

  let calkowita = s;
  let ulamek = '';
  if (dziesietny) {
    const i = s.lastIndexOf(dziesietny);
    calkowita = s.slice(0, i);
    ulamek = s.slice(i + 1);
    if (!/^\d{1,2}$/.test(ulamek)) return null;
  }
  if (tysiace) {
    const grupy = calkowita.split(tysiace);
    if (!/^\d{1,3}$/.test(grupy[0]) || grupy.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
    calkowita = grupy.join('');
  }
  if (!/^\d+$/.test(calkowita)) return null;

  const gr = Number(calkowita) * 100 + Number(ulamek.padEnd(2, '0'));
  return Number.isSafeInteger(gr) ? znak * gr || 0 : null;
}

// ---------------------------------------------------------------------
// Daty (Z37: daty bez godziny jako tekst RRRR-MM-DD, strefa Europe/Warsaw)
// ---------------------------------------------------------------------

export const MIESIACE = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
/** Miejscownik do zdań „Brakujące wpłaty w listopadzie”. */
export const MIESIACE_W = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu',
  'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
export const MIESIACE_KROTKO = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
  'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

const pad2 = (n) => String(n).padStart(2, '0');

/** Składa datę ISO z liczb. */
export function iso(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Rozbiera datę ISO na liczby; null, gdy data nie istnieje (np. 2026-02-30). */
export function parseData(tekst) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > dniWMiesiacu(y, mo)) return null;
  return { y, m: mo, d };
}

/**
 * Data wpisana albo zapisana przez Excel → RRRR-MM-DD; null, gdy to nie data.
 * Obsługuje: "2026-03-15", "15.03.2026", "5.3.2026", "15-03-2026", "15/03/2026".
 */
export function czytajDate(tekst) {
  const s = String(tekst ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseData(s) ? s : null;
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
  if (!m) return null;
  const wynik = iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return parseData(wynik) ? wynik : null;
}

/** Kwota w groszach do pola formularza: 33000 → "330,00", -1250 → "-12,50", null → "". */
export function kwotaDoPola(gr) {
  if (gr == null || !Number.isFinite(gr)) return '';
  const abs = Math.abs(gr);
  return `${gr < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Dzisiejsza data w Polsce, niezależnie od strefy urządzenia. */
export function dzisiaj(teraz = new Date()) {
  const czesci = new Intl.DateTimeFormat('en-CA', {
    timeZone: STREFA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(teraz);
  const v = Object.fromEntries(czesci.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

/** Data w Polsce dla znacznika czasu z bazy (timestamptz w UTC): '2026-03-28T23:30:00Z' → '2026-03-29'. */
export function dataZeZnacznika(znacznik) {
  return dzisiaj(new Date(znacznik));
}

export function dniWMiesiacu(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const naUTC = (tekst) => {
  const p = parseData(tekst);
  if (!p) throw new RangeError(`Nieprawidłowa data: ${tekst}`);
  return Date.UTC(p.y, p.m - 1, p.d);
};
const zUTC = (ms) => {
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export function dodajDni(tekst, n) {
  return zUTC(naUTC(tekst) + n * 86_400_000);
}

/** Liczba dni od a do b (b − a). roznicaDni('2026-04-05', '2026-04-10') → 5 */
export function roznicaDni(a, b) {
  return Math.round((naUTC(b) - naUTC(a)) / 86_400_000);
}

/**
 * Przesuwa datę o n miesięcy i ustawia dzień `dzien` (domyślnie dzień z daty).
 * Gdy miesiąc jest krótszy, zwraca jego ostatni dzień (Z5):
 * dodajMiesiace('2027-01-31', 1) → '2027-02-28'; dodajMiesiace('2027-01-31', 2) → '2027-03-31'
 */
export function dodajMiesiace(tekst, n, dzien = null) {
  const p = parseData(tekst);
  if (!p) throw new RangeError(`Nieprawidłowa data: ${tekst}`);
  const indeks = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(indeks / 12);
  const m = (indeks % 12) + 1;
  return iso(y, m, Math.min(dzien ?? p.d, dniWMiesiacu(y, m)));
}

/** "2026-10-15" → "15.10.2026" (tabele) */
export function formatData(tekst) {
  const p = parseData(tekst);
  return p ? `${pad2(p.d)}.${pad2(p.m)}.${p.y}` : '—';
}

/** "2026-10-15" → "15 paź" (krótkie podpisy) */
export function formatDataKrotka(tekst) {
  const p = parseData(tekst);
  return p ? `${p.d} ${MIESIACE_KROTKO[p.m - 1]}` : '—';
}

/** "2026-11-09" → "2026-11" */
export const kluczMiesiaca = (tekst) => tekst.slice(0, 7);

/** "2026-11" → "listopad 2026" */
export function etykietaMiesiaca(klucz) {
  const [y, m] = klucz.split('-').map(Number);
  return `${MIESIACE[m - 1]} ${y}`;
}

/** Lista kluczy miesięcy od `od` do `do` włącznie: ('2026-11', '2027-01') → ['2026-11','2026-12','2027-01'] */
export function zakresMiesiecy(od, doMiesiaca) {
  const wynik = [];
  let [y, m] = od.split('-').map(Number);
  const [yk, mk] = doMiesiaca.split('-').map(Number);
  while (y < yk || (y === yk && m <= mk)) {
    wynik.push(`${y}-${pad2(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return wynik;
}

// ---------------------------------------------------------------------
// Tekst
// ---------------------------------------------------------------------

/**
 * Wielkie litery, bez ogonków, tylko litery, cyfry i pojedyncze spacje.
 * „Łukasz Żółć-Kowalska” → "LUKASZ ZOLC KOWALSKA". Litera ł nie rozkłada się przez NFD, stąd osobna zamiana.
 */
export function normalizujTekst(tekst) {
  return String(tekst ?? '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')   // znaki diakrytyczne
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Losowy UUID v4 dla wierszy zapisywanych pakietem (zapisz_pakiet). crypto.randomUUID działa tylko
 * w bezpiecznym kontekście (https, localhost) – przy testach z telefonu po http w sieci lokalnej
 * zostaje crypto.getRandomValues.
 */
export function noweId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;   // wersja 4
  b[8] = (b[8] & 0x3f) | 0x80;   // wariant RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ucieczka znaków HTML dla tekstu wstawianego do szablonów. */
export function esc(tekst) {
  return String(tekst ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Liczba z rzeczownikiem w dobrej formie: odmiana(1, ['najem', 'najmy', 'najmów']) → "1 najem",
 * 3 → "3 najmy", 5 → "5 najmów", 22 → "22 najmy", 12 → "12 najmów".
 */
export function odmiana(n, [jeden, kilka, wiele]) {
  if (n === 1) return `${n} ${jeden}`;
  const j = n % 10;
  const nascie = n % 100 >= 12 && n % 100 <= 14;
  return `${n} ${j >= 2 && j <= 4 && !nascie ? kilka : wiele}`;
}

/** Kolejny numer jednostki do podpowiedzi: "G-03" → "G-04", "B9" → "B10", "BOX" → "". */
export function nastepnyNumer(kod) {
  const tekst = String(kod ?? '');
  // Kod z rzędem (G05R1 → G06R1): numer jednostki to pierwsza liczba; inaczej ostatnia (B9 → B10, B01XS → B02XS).
  const m = /^([GK]\D*?)(\d+)(\D*R\d+)$/i.exec(tekst) ?? /^(.*?)(\d+)(\D*)$/.exec(tekst);
  if (!m) return '';
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') + m[3];
}

/** Porównanie numerów jednostek „naturalnie”: G-2 < G-10. */
export function porownajKody(a, b) {
  return String(a).localeCompare(String(b), 'pl', { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------------
// Walidacja pól formularzy (8.6)
// ---------------------------------------------------------------------

const WAGI_NIP = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/** Zostawia same cyfry NIP (usuwa spacje, kreski i prefiks PL). */
export function oczyscNip(tekst) {
  return String(tekst ?? '').replace(/^PL/i, '').replace(/[\s-]/g, '');
}

/** NIP: 10 cyfr z poprawną sumą kontrolną. */
export function walidujNip(tekst) {
  const nip = oczyscNip(tekst);
  if (!/^\d{10}$/.test(nip) || /^0+$/.test(nip)) return false;
  const suma = WAGI_NIP.reduce((s, w, i) => s + w * Number(nip[i]), 0) % 11;
  return suma !== 10 && suma === Number(nip[9]);
}

/** Telefon: 9 cyfr albo z prefiksem +48 (spacje i kreski dozwolone). */
export function walidujTelefon(tekst) {
  return /^(\+48)?\d{9}$/.test(String(tekst ?? '').replace(/[\s-]/g, ''));
}

export function walidujEmail(tekst) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(tekst ?? '').trim());
}

/** Numer rachunku: same cyfry bez prefiksu PL; null, gdy nie ma 26 cyfr (7.2). */
export function oczyscRachunek(tekst) {
  const cyfry = String(tekst ?? '').replace(/^PL/i, '').replace(/\D/g, '');
  return cyfry.length === 26 ? cyfry : null;
}

/** 26 cyfr rachunku w zapisie do czytania: "61 1090 1014 0000 0712 1981 2874". */
export function formatRachunek(cyfry) {
  if (!/^\d{26}$/.test(cyfry ?? '')) return cyfry ?? '';
  return `${cyfry.slice(0, 2)} ${cyfry.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
}
