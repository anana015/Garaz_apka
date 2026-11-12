// Umowy do podpisania z wzorów Word (.docx) – prośba z 11.11.2026.
// Wzór to zwykły dokument Word z polami w podwójnych nawiasach klamrowych, np. {{klient}}, {{stawka}}, {{jednostka}}.
// Aplikacja podmienia pola danymi z karty klienta i najmu i oddaje gotowy plik .docx do wydruku.
// Czyste funkcje (tests/umowy.test.js); JSZip przekazywany z zewnątrz (w przeglądarce db.jszip(), w testach pakiet npm).

import { TYPY_JEDNOSTEK } from './config.js';
import { promocjaNajmu, promocjeNajmu } from './promocje.js';
import { dodajMiesiace, formatData, formatRachunek, formatZl, roznicaDni } from './utils.js';
import { TYPY_DOKUMENTU } from './walidacja.js';

/** Brak danej w umowie: miejsce do wpisania ręcznie. */
export const PUSTE_MIEJSCE = '……………………';

/** Pola dostępne we wzorach – kolejność jak w podpowiedzi w Ustawieniach. */
export const POLA_UMOWY = Object.freeze([
  { klucz: 'dane_wynajmujacego', opis: 'Dane wynajmującego – wybierane przy umowie (Ustawienia → Dane wynajmującego)' },
  { klucz: 'klient', opis: 'Imię i nazwisko albo nazwa firmy' },
  { klucz: 'klient_adres', opis: 'Adres klienta' },
  { klucz: 'klient_telefon', opis: 'Telefon' },
  { klucz: 'klient_email', opis: 'E-mail' },
  { klucz: 'klient_pesel', opis: 'PESEL' },
  { klucz: 'klient_pesel_nip', opis: 'PESEL (osoba) albo NIP (firma)' },
  { klucz: 'klient_dokument', opis: 'Dokument tożsamości z numerem, np. „dowód osobisty ABC123456”' },
  { klucz: 'klient_dokument_typ', opis: 'Rodzaj dokumentu' },
  { klucz: 'klient_dokument_numer', opis: 'Numer dokumentu' },
  { klucz: 'klient_nip', opis: 'NIP (firma)' },
  { klucz: 'osoba_kontaktowa', opis: 'Osoba kontaktowa / reprezentant (firma)' },
  { klucz: 'jednostka', opis: 'Numer jednostki (kilka: „G-03, B-12”)' },
  { klucz: 'jednostka_typ', opis: 'Rodzaj jednostki, np. „garaż”' },
  { klucz: 'jednostka_powierzchnia', opis: 'Powierzchnia, np. „18 m²”' },
  { klucz: 'stawka', opis: 'Miesięczny czynsz (regularny – po promocji), sama kwota bez „zł”, np. „330” (we wzorze dalej „złotych”)' },
  { klucz: 'stawka_slownie', opis: 'Czynsz słownie' },
  { klucz: 'stawka_poczatkowa', opis: 'Czynsz od pierwszego miesiąca (z promocją, jeśli jest), sama kwota bez „zł”' },
  { klucz: 'stawka_poczatkowa_slownie', opis: 'Czynsz od pierwszego miesiąca słownie' },
  { klucz: 'promocja_do', opis: 'Ostatni dzień promocji (puste, gdy bez promocji)' },
  { klucz: 'promocja', opis: '„, przy czym przez pierwsze dwa miesiące…” – dopisek o promocji na start (puste bez promocji)' },
  { klucz: 'prad', opis: 'Krótki zapis o prądzie (puste, gdy jednostka bez prądu)' },
  { klucz: 'klauzula_prad', opis: 'Klauzula o prądzie: cena 1 kWh, rozliczenie kwartalne, stan licznika (puste bez prądu)' },
  { klucz: 'kaucja', opis: 'Kaucja (puste – boxy bez kaucji albo jeszcze nie wpisana)' },
  { klucz: 'kaucja_slownie', opis: 'Kaucja słownie' },
  { klucz: 'data_startu', opis: 'Początek najmu' },
  { klucz: 'umowa_do', opis: 'Koniec umowy albo „czas nieokreślony”' },
  { klucz: 'okres_wypowiedzenia', opis: 'Okres wypowiedzenia w dniach, np. „30” (we wzorze dalej „dni”) – wpisywany przy umowie' },
  { klucz: 'dzien_platnosci', opis: 'Dzień miesiąca płatności, np. „20”' },
  { klucz: 'forma_platnosci', opis: '„przelewem na rachunek …”, „gotówką” albo „na podstawie faktury”' },
  { klucz: 'konto', opis: 'Numer rachunku do wpłat' },
  { klucz: 'numer_konta', opis: 'Numer rachunku do wpłat (to samo co konto)' },
  { klucz: 'numer_umowy', opis: 'Numer umowy' },
  { klucz: 'data_umowy', opis: 'Data zawarcia umowy' },
  { klucz: 'dzis', opis: 'Dzisiejsza data' },
]);
const ZNANE = new Set(POLA_UMOWY.map((p) => p.klucz));
/** Pola, w których zostają podziały wierszy (Enter → nowa linia w Wordzie). */
const WIELOLINIOWE = new Set(['dane_wynajmujacego']);
/** Pola-dopiski: bez danej zostają puste (bez kropek), np. brak promocji albo jednostka bez prądu. */
export const POLA_OPCJONALNE = new Set(['promocja', 'klauzula_prad', 'prad', 'promocja_do']);

/** Cena prądu w klauzuli (prośba 12.11.2026). */
export const CENA_KWH = '1,3 zł brutto (słownie: jeden złoty trzydzieści groszy brutto)';
const DOPELNIACZ = { garaz: 'garażu', kontener: 'kontenera', box_duzy: 'boxa', box_maly: 'boxa' };

/** Kwota bez „zł”: 20000 → „200”, 20050 → „200,50” (we wzorze dalej „złotych brutto”). */
const kwotaLiczba = (gr) => formatZl(gr, { grosze: gr % 100 !== 0, waluta: false });

/** Okres wypowiedzenia w dniach z pola umowy: „30” → 30, „1 miesiąc” → 30, „2 miesiące” → 60; inaczej null. */
export function dniWypowiedzenia(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const m = t.match(/^(\d+)\s*(dni|dzień|d)?\.?$/);
  if (m) return Number(m[1]);
  const mies = t.match(/^(\d+)?\s*mies/);
  if (mies) return 30 * Number(mies[1] ?? 1);
  return null;
}

// ---------------------------------------------------------------------
// Kwota słownie
// ---------------------------------------------------------------------

const JEDNOSCI = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć',
  'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const DZIESIATKI = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt',
  'osiemdziesiąt', 'dziewięćdziesiąt'];
const SETKI = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
const RZEDY = [['', '', ''], ['tysiąc', 'tysiące', 'tysięcy'], ['milion', 'miliony', 'milionów']];

/** Forma liczebnika: 1 → [0], 2–4 (bez 12–14) → [1], reszta → [2]. */
const forma = (n, [jeden, kilka, wiele]) => {
  if (n === 1) return jeden;
  const j = n % 10;
  const nascie = n % 100 >= 12 && n % 100 <= 14;
  return j >= 2 && j <= 4 && !nascie ? kilka : wiele;
};

function trojka(n) {
  const s = Math.floor(n / 100);
  const r = n % 100;
  const slowa = [SETKI[s]];
  if (r < 20) slowa.push(JEDNOSCI[r]);
  else slowa.push(DZIESIATKI[Math.floor(r / 10)], JEDNOSCI[r % 10]);
  return slowa.filter(Boolean).join(' ');
}

/** 330 → „trzysta trzydzieści”; 0 → „zero”. Liczby całkowite do 999 999 999. */
export function liczbaSlownie(n) {
  if (n === 0) return 'zero';
  const czesci = [];
  let rzad = 0;
  let x = n;
  while (x > 0) {
    const t = x % 1000;
    if (t) {
      const nazwa = rzad ? forma(t, RZEDY[rzad]) : '';
      czesci.unshift(rzad && t === 1 ? nazwa : [trojka(t), nazwa].filter(Boolean).join(' '));
    }
    x = Math.floor(x / 1000);
    rzad += 1;
  }
  return czesci.join(' ');
}

/** 33050 gr → „trzysta trzydzieści złotych 50/100”. */
export function kwotaSlownie(gr) {
  const zl = Math.floor(Math.abs(gr) / 100);
  const grosze = Math.abs(gr) % 100;
  return `${liczbaSlownie(zl)} ${forma(zl, ['złoty', 'złote', 'złotych'])} ${String(grosze).padStart(2, '0')}/100`;
}

// ---------------------------------------------------------------------
// Dane do umowy
// ---------------------------------------------------------------------

const stawkiPosortowane = (s, najemId) => [...(s.indeksy.stawkiNajmu.get(najemId) ?? [])]
  .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

/**
 * Wartości pól umowy dla klienta i wybranych najmów (zwykle jednej umowy).
 * @param {{ dane, indeksy }} s stan aplikacji
 * @param {{ klientId: string, najemIds: string[], dataUmowy?: string, numer?: string, dzis: string }} o
 * @returns {Record<string, string>} puste pole = brak danej (w dokumencie: PUSTE_MIEJSCE)
 */
export function daneUmowy(s, { klientId, najemIds, dataUmowy, numer, dzis, wynajmujacy = '', licznik = '', okresDni = '' }) {
  const k = s.indeksy.klienci.get(klientId) ?? {};
  const najmy = najemIds.map((id) => s.dane.rentals.find((n) => n.id === id)).filter(Boolean)
    .sort((a, b) => (s.indeksy.jednostki.get(a.unit_id)?.code ?? '').localeCompare(s.indeksy.jednostki.get(b.unit_id)?.code ?? '', 'pl', { numeric: true }));
  const jednostki = najmy.map((n) => s.indeksy.jednostki.get(n.unit_id)).filter(Boolean);
  const umowa = najmy.length ? s.indeksy.umowy.get(najmy[0].contract_id) : null;
  const unikalne = (lista) => [...new Set(lista.filter(Boolean))];

  // Stawki: początkowa (od startu, z promocją) i regularna (ostatnia w historii – po promocji).
  let poczatkowaGr = 0;
  let regularnaGr = 0;
  const koncePromocji = [];
  const promocjeStart = [];   // promocja zaczynająca się w pierwszym miesiącu najmu
  for (const n of najmy) {
    const st = stawkiPosortowane(s, n.id);
    if (!st.length) continue;
    // Pierwsza płatna stawka (stawka 0 zł = końcówka miesiąca gratis przy promocji od 23. dnia – pomijamy).
    const odStartu = st.filter((x) => x.valid_from <= n.start_on && x.amount_gr > 0).at(-1) ?? st.find((x) => x.amount_gr > 0) ?? st[0];
    poczatkowaGr += odStartu.amount_gr;
    regularnaGr += st.at(-1).amount_gr;
    const p = promocjaNajmu(st, n.start_on > dzis ? n.start_on : dzis);
    if (p?.do) koncePromocji.push(p.do);
    const start = promocjeNajmu(st).find((x) => x.od >= n.start_on && x.od < dodajMiesiace(n.start_on, 1));
    if (start) promocjeStart.push(start);
  }
  // „, przy czym przez pierwsze dwa miesiące…” – tekst z prośby 12.11 dla −50% / ok. 2 miesiące, inaczej opis ogólny.
  let promocja = '';
  if (promocjeStart.length) {
    const p = promocjeStart[0];
    const polowa = p.regularnaGr != null && Math.abs(p.promocyjnaGr * 2 - p.regularnaGr) <= 100;
    const dni = p.do ? roznicaDni(p.od, p.do) + 1 : null;
    promocja = polowa && dni != null && dni >= 45 && dni <= 75
      ? ', przy czym przez pierwsze dwa miesiące najmu czynsz będzie wynosić połowę stawki i będzie on płatny z góry za dwa miesiące'
      : `, przy czym ${p.do ? `do dnia ${formatData(p.do)}` : 'w okresie promocji'} czynsz będzie wynosić ${kwotaLiczba(p.promocyjnaGr)} złotych brutto`;
  }
  const zPradem = jednostki.filter((j) => j.has_power);
  const licznikTekst = String(licznik ?? '').trim() || '……….';
  const klauzulaPrad = zPradem.length
    ? `Prąd będzie rozliczany według zużycia. Cena za 1 kWh to ${CENA_KWH}. Należność za prąd płatna jest raz na kwartał, `
      + `na koniec kwartału. Stan licznika na dzień wydania ${DOPELNIACZ[zPradem[0].type] ?? 'jednostki'}${
        zPradem.length > 1 ? ` ${zPradem.map((j) => j.code).join(', ')}` : ''} to: ${licznikTekst} kWh`
    : '';
  const dniWyp = String(okresDni ?? '').trim() || (dniWypowiedzenia(umowa?.notice_period) ?? '');

  // Kaucja: przyjęcia minus zwroty i zatrzymania w umowie.
  const ruchy = umowa ? s.dane.deposits.filter((d) => d.contract_id === umowa.id) : [];
  const kaucjaGr = ruchy.reduce((x, d) => x + (d.kind === 'przyjecie' ? d.amount_gr : -d.amount_gr), 0);

  // Płatność: z pierwszego najmu (zwykle wszystkie w umowie płacą tak samo).
  const n0 = najmy[0];
  const konto = n0?.bank_account_id ? s.indeksy.konta.get(n0.bank_account_id) : null;
  let formaPlatnosci = '';
  if (n0?.pay_method === 'gotowka') formaPlatnosci = 'gotówką';
  else if (n0?.pay_method === 'fv') formaPlatnosci = 'na podstawie faktury';
  else if (konto?.iban) formaPlatnosci = `przelewem na rachunek nr ${formatRachunek(konto.iban)}`;
  else if (n0) formaPlatnosci = 'przelewem';

  const powierzchnia = jednostki.filter((j) => j.area_m2 != null);
  const dokumentTyp = k.doc_type ? (TYPY_DOKUMENTU[k.doc_type] ?? '').toLowerCase() : '';
  const daty = unikalne(najmy.map((n) => n.start_on)).sort();
  return {
    klient: k.name ?? '',
    klient_adres: k.address ?? '',
    klient_telefon: k.phone ?? '',
    klient_email: k.email ?? '',
    klient_pesel: k.pesel ?? '',
    klient_pesel_nip: k.pesel || k.nip || '',
    dane_wynajmujacego: String(wynajmujacy ?? '').trim(),
    klient_dokument: k.doc_number ? `${dokumentTyp || 'dokument'} ${k.doc_number}` : '',
    klient_dokument_typ: dokumentTyp,
    klient_dokument_numer: k.doc_number ?? '',
    klient_nip: k.nip ?? '',
    osoba_kontaktowa: k.contact_person ?? '',
    jednostka: jednostki.map((j) => j.code).join(', '),
    jednostka_typ: unikalne(jednostki.map((j) => TYPY_JEDNOSTEK[j.type]?.nazwa.toLowerCase())).join(', '),
    jednostka_powierzchnia: powierzchnia.length
      ? `${String(powierzchnia.reduce((x, j) => x + Number(j.area_m2), 0)).replace('.', ',')} m²` : '',
    stawka: regularnaGr ? kwotaLiczba(regularnaGr) : '',
    stawka_slownie: regularnaGr ? kwotaSlownie(regularnaGr) : '',
    stawka_poczatkowa: poczatkowaGr ? kwotaLiczba(poczatkowaGr) : '',
    stawka_poczatkowa_slownie: poczatkowaGr ? kwotaSlownie(poczatkowaGr) : '',
    promocja_do: koncePromocji.length ? formatData(koncePromocji.sort().at(-1)) : '',
    promocja,
    klauzula_prad: klauzulaPrad,
    prad: jednostki.some((j) => j.has_power)
      ? `${jednostki.length > 1 ? `Jednostki z prądem: ${jednostki.filter((j) => j.has_power).map((j) => j.code).join(', ')}. ` : ''}`
        + 'Rachunki za zużyty prąd rozliczane są raz na kwartał.' : '',
    kaucja: kaucjaGr > 0 ? formatZl(kaucjaGr) : '',
    kaucja_slownie: kaucjaGr > 0 ? kwotaSlownie(kaucjaGr) : '',
    data_startu: daty.map(formatData).join(', '),
    umowa_do: umowa ? (umowa.valid_until ? formatData(umowa.valid_until) : 'czas nieokreślony') : '',
    okres_wypowiedzenia: String(dniWyp),
    dzien_platnosci: unikalne(najmy.map((n) => String(n.billing_day))).join(', '),
    forma_platnosci: formaPlatnosci,
    konto: konto?.iban ? formatRachunek(konto.iban) : '',
    numer_konta: konto?.iban ? formatRachunek(konto.iban) : '',
    numer_umowy: numer ?? umowa?.number ?? '',
    data_umowy: formatData(dataUmowy || umowa?.signed_on || dzis),
    dzis: formatData(dzis),
  };
}

// ---------------------------------------------------------------------
// Wypełnianie dokumentu Word
// ---------------------------------------------------------------------

const POLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const WEZEL_T = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
const escXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Podmienia pola {{nazwa}} w XML-u dokumentu Word. Word często dzieli tekst pola na kilka fragmentów (<w:t>),
 * np. „{{kli” + „ent}}” – dlatego pola szukamy w połączonym tekście wszystkich fragmentów i podmieniamy
 * fragmenty, w których leży. Formatowanie zostaje takie jak na początku pola.
 * @param {string} xml
 * @param {Record<string, string>} wartosci
 * @returns {{ xml: string, uzyte: string[], nieznane: string[], puste: string[] }}
 */
export function wypelnijXml(xml, wartosci) {
  const wezly = [];
  for (const m of xml.matchAll(WEZEL_T)) wezly.push({ start: m.index, dlugosc: m[0].length, attr: m[1] ?? '', tekst: m[2] });
  if (!wezly.length) return { xml, uzyte: [], nieznane: [], puste: [] };
  // Pozycje fragmentów w połączonym tekście.
  let poz = 0;
  for (const w of wezly) { w.od = poz; poz += w.tekst.length; }
  const calosc = wezly.map((w) => w.tekst).join('');
  const uzyte = new Set();
  const nieznane = new Set();
  const puste = new Set();
  const trafienia = [...calosc.matchAll(POLE)];
  // Od końca, żeby wcześniejsze pozycje się nie przesuwały.
  for (const m of trafienia.reverse()) {
    const klucz = m[1].toLowerCase();
    let wartosc;
    if (!ZNANE.has(klucz) && !(klucz in wartosci)) { nieznane.add(m[1]); continue; }
    if (wartosci[klucz]) {
      const tekst = String(wartosci[klucz]).replace(/\r/g, '');
      // Wiele linii: nowa linia w tym samym akapicie (<w:br/>); w pozostałych polach – przecinek.
      wartosc = WIELOLINIOWE.has(klucz)
        ? tekst.split(/\s*\n\s*/).map(escXml).join('</w:t><w:br/><w:t xml:space="preserve">')
        : escXml(tekst.replace(/\s*\n\s*/g, ', '));
      uzyte.add(klucz);
    }
    else if (POLA_OPCJONALNE.has(klucz)) wartosc = '';
    else { wartosc = PUSTE_MIEJSCE; puste.add(klucz); }
    const a = m.index;
    const b = m.index + m[0].length;
    for (const w of wezly) {
      const wOd = w.od;
      const wDo = w.od + w.tekst.length;
      if (wDo <= a || wOd >= b) continue;
      const przed = a > wOd ? w.tekst.slice(0, a - wOd) : '';
      const po = b < wDo ? w.tekst.slice(b - wOd) : '';
      const pierwszy = a >= wOd && a < wDo;
      w.tekst = przed + (pierwszy ? wartosc : '') + po;
      w.zmieniony = true;
    }
    // Długości się zmieniły dopiero od tego pola dalej; kolejne (wcześniejsze w tekście) trafienia mają te same pozycje.
    let p = 0;
    for (const w of wezly) { w.od = p; p += w.tekst.length; }
  }
  let wynik = '';
  let ostatni = 0;
  for (const w of wezly) {
    wynik += xml.slice(ostatni, w.start);
    const attr = w.zmieniony && !/xml:space=/.test(w.attr) ? `${w.attr} xml:space="preserve"` : w.attr;
    wynik += `<w:t${attr}>${w.tekst}</w:t>`;
    ostatni = w.start + w.dlugosc;
  }
  wynik += xml.slice(ostatni);
  return { xml: wynik, uzyte: [...uzyte], nieznane: [...nieznane], puste: [...puste] };
}

/** Części dokumentu z tekstem: treść, nagłówki, stopki, przypisy. */
const CZESCI = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/** Pola użyte we wzorze (do podglądu przy wgrywaniu). Zwraca { pola: [...], nieznane: [...] } albo rzuca błąd. */
export async function polaWzoru(JSZip, plik) {
  const zip = await otworzDocx(JSZip, plik);
  const pola = new Set();
  for (const nazwa of Object.keys(zip.files).filter((n) => CZESCI.test(n))) {
    const tekst = [...(await zip.file(nazwa).async('string')).matchAll(WEZEL_T)].map((m) => m[2]).join('');
    for (const m of tekst.matchAll(POLE)) pola.add(m[1].toLowerCase());
  }
  return { pola: [...pola], nieznane: [...pola].filter((p) => !ZNANE.has(p)) };
}

async function otworzDocx(JSZip, plik) {
  let zip;
  try {
    zip = await JSZip.loadAsync(plik);
  } catch {
    throw new Error('To nie jest plik Word (.docx). Zapisz wzór w Wordzie jako „Dokument programu Word (.docx)”.');
  }
  if (!zip.file('word/document.xml')) throw new Error('To nie jest plik Word (.docx) – brak treści dokumentu.');
  return zip;
}

/**
 * Wypełnia wzór .docx. Zwraca plik (typ wg `typ`, domyślnie Blob w przeglądarce) i listy pól.
 * @returns {Promise<{ plik, uzyte: string[], nieznane: string[], puste: string[] }>}
 */
export async function wypelnijDocx(JSZip, wzor, wartosci, { typ = 'blob' } = {}) {
  const zip = await otworzDocx(JSZip, wzor);
  const uzyte = new Set();
  const nieznane = new Set();
  const puste = new Set();
  for (const nazwa of Object.keys(zip.files).filter((n) => CZESCI.test(n))) {
    const w = wypelnijXml(await zip.file(nazwa).async('string'), wartosci);
    w.uzyte.forEach((x) => uzyte.add(x));
    w.nieznane.forEach((x) => nieznane.add(x));
    w.puste.forEach((x) => puste.add(x));
    zip.file(nazwa, w.xml);
  }
  const plik = await zip.generateAsync({
    type: typ, compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  return { plik, uzyte: [...uzyte], nieznane: [...nieznane], puste: [...puste] };
}

/** Nazwa pliku: Umowa_G-03_Kowalski_Jan_2026-11-11.docx (bez znaków niedozwolonych w nazwach plików). */
export function nazwaPlikuUmowy(wartosci, dzis) {
  const czesc = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return ['Umowa', czesc(wartosci.jednostka), czesc(wartosci.klient), dzis].filter(Boolean).join('_') + '.docx';
}
