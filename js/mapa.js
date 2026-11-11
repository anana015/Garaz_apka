// Mapa placu (prośba 11.11): układ rzędów R1–R4 i boxów oraz dopasowanie jednostek po kodzie.
// Czysta logika bez DOM – rysowanie jest w js/views/jednostki.js.
//
// Numeracja z mapki użytkownika: w każdym rzędzie numery rosną od wjazdu (południe) na północ;
// najpierw prawa strona alejki (od 1), potem lewa (dalsze numery). Kod garażu: G05R1 = garaż 5 w rzędzie 1
// (K zamiast G – kontener). Boxy: osobna numeracja XL (duże, 4 m²) i XS (małe, 3 m²), kod B01XS / B02XL;
// bez końcówki XS/XL rozmiar bierzemy z typu jednostki.

/** Wymiary w jednostkach SVG: viewBox 0 GORA SZEROKOSC (WYSOKOSC − GORA). Nad GORA nic nie ma. */
export const SZEROKOSC = 700;
export const WYSOKOSC = 290;
export const GORA = 52;
const DOL = 250;                 // linia wjazdu – tu zaczyna się numeracja każdej kolumny
const G_SZER = 30, G_WYS = 17;   // garaż / kontener
const B_SZER = 26;               // box

/**
 * Kolumny placu z zachodu na wschód. x – lewa krawędź, od – pierwszy numer (przy wjeździe), ile – liczba jednostek.
 * Strony rzędu: „prawa” i „lewa” patrząc od wjazdu w głąb alejki.
 */
export const KOLUMNY = Object.freeze([
  { rzad: 1, strona: 'lewa', x: 20, od: 10, ile: 11 },
  { rzad: 1, strona: 'prawa', x: 84, od: 1, ile: 9 },
  { rzad: 2, strona: 'lewa', x: 114, od: 10, ile: 9 },
  { rzad: 2, strona: 'prawa', x: 178, od: 1, ile: 9 },
  { rzad: 3, strona: 'lewa', x: 208, od: 10, ile: 10 },
  { rzad: 3, strona: 'prawa', x: 272, od: 1, ile: 9 },
  { rzad: 4, strona: 'lewa', x: 302, od: 7, ile: 7 },
  { rzad: 4, strona: 'prawa', x: 366, od: 1, ile: 6 },
]);

/** Alejki między stronami rzędu: środek x (podpis „R1”…). */
export const ALEJKI = Object.freeze([
  { rzad: 1, x: 67 }, { rzad: 2, x: 161 }, { rzad: 3, x: 255 }, { rzad: 4, x: 349 },
]);

/** Klucz miejsca: 'R2-14' (garaż/kontener), 'BD-7' (duży box), 'BM-4' (mały box). */
const kluczRzedu = (rzad, nr) => `R${rzad}-${nr}`;
const kluczBoxu = (duzy, nr) => `${duzy ? 'BD' : 'BM'}-${nr}`;

/** Wszystkie miejsca na mapie: { klucz, x, y, w, h, etykieta, opis, typ }. */
function zbudujMiejsca() {
  const m = [];
  for (const k of KOLUMNY) {
    for (let i = 0; i < k.ile; i++) {
      const nr = k.od + i;
      m.push({ klucz: kluczRzedu(k.rzad, nr), x: k.x, y: DOL - (i + 1) * G_WYS, w: G_SZER, h: G_WYS,
        etykieta: String(nr), opis: `Rząd ${k.rzad}, nr ${nr}`, typ: 'rzad' });
    }
  }
  // Kolumna boxów przy R4 (od wjazdu): duże 1–6, nad nimi małe 1–3.
  const kolX = 396, kolH = 15;
  for (let i = 0; i < 9; i++) {
    const duzy = i < 6;
    const nr = duzy ? i + 1 : i - 5;
    m.push({ klucz: kluczBoxu(duzy, nr), x: kolX, y: DOL - (i + 1) * kolH, w: B_SZER, h: kolH,
      etykieta: `${duzy ? 'XL' : 'XS'}${nr}`, opis: `Box ${duzy ? 'XL' : 'XS'} nr ${nr}`, typ: duzy ? 'box_duzy' : 'box_maly' });
  }
  // Boxy w kształcie L: poziomo duże 7–15 (z zachodu na wschód), pionowo nad pierwszym małe 4–6 (od dołu).
  const lX = 450, lY = 160, lH = 20, pionH = 17;
  for (let i = 0; i < 9; i++) {
    const nr = 7 + i;
    m.push({ klucz: kluczBoxu(true, nr), x: lX + i * B_SZER, y: lY, w: B_SZER, h: lH,
      etykieta: `XL${nr}`, opis: `Box XL nr ${nr}`, typ: 'box_duzy' });
  }
  for (let i = 0; i < 3; i++) {
    const nr = 4 + i;
    m.push({ klucz: kluczBoxu(false, nr), x: lX, y: lY - (i + 1) * pionH, w: B_SZER, h: pionH,
      etykieta: `XS${nr}`, opis: `Box XS nr ${nr}`, typ: 'box_maly' });
  }
  return Object.freeze(m.map(Object.freeze));
}

export const MIEJSCA = zbudujMiejsca();
export const LINIA_WJAZDU = DOL;

/**
 * Miejsca, na których jednostka stoi, ale jest wyłączona z najmu (prośba 11.11: G18R1).
 * Gdy jej jeszcze nie ma w aplikacji, mapa i tak pokazuje ją jako wyłączoną (a nie „brak w aplikacji”);
 * dopisanie do bazy: supabase/jednorazowe/g18r1_wylaczona.sql.
 */
export const WYLACZONE_MIEJSCA = Object.freeze(new Set(['R1-18']));

const WZOR_BOXU = /^B\s*-?\s*0*(\d{1,3})\s*-?\s*(XS|XL)$/i;
const WZOR_RZEDU = /^[GK]\s*-?\s*0*(\d{1,3})\s*[-/ ]?\s*R\s*-?\s*0*(\d)$/i;

/**
 * Klucz miejsca dla jednostki albo null, gdy nie da się jej umieścić na mapie.
 * „G05R1”, „g5r1”, „K-12-R3” → 'R1-5' / 'R3-12'; „B01XS” → 'BM-1', „B02XL” → 'BD-2';
 * box bez końcówki: typ box_duzy / box_maly + pierwsza liczba w kodzie.
 */
export function miejsceJednostki(j) {
  const kod = String(j?.code ?? '').trim();
  const r = WZOR_RZEDU.exec(kod);
  if (r) return kluczRzedu(Number(r[2]), Number(r[1]));
  const b = WZOR_BOXU.exec(kod);
  if (b) return kluczBoxu(b[2].toUpperCase() === 'XL', Number(b[1]));
  if (j?.type === 'box_duzy' || j?.type === 'box_maly') {
    const nr = /(\d+)/.exec(kod);
    if (nr) return kluczBoxu(j.type === 'box_duzy', Number(nr[1]));
  }
  return null;
}

/**
 * Przypisuje jednostki (bez zarchiwizowanych) do miejsc.
 * Zwraca { naMapie: Map<klucz, jednostka>, pozaMapa: jednostki bez miejsca, duplikaty: jednostki na zajętym już miejscu }.
 */
export function rozmiescJednostki(jednostki) {
  const klucze = new Set(MIEJSCA.map((m) => m.klucz));
  const naMapie = new Map();
  const pozaMapa = [];
  const duplikaty = [];
  for (const j of jednostki) {
    if (j.archived) continue;
    const k = miejsceJednostki(j);
    if (!k || !klucze.has(k)) pozaMapa.push(j);
    else if (naMapie.has(k)) duplikaty.push(j);
    else naMapie.set(k, j);
  }
  return { naMapie, pozaMapa, duplikaty };
}
