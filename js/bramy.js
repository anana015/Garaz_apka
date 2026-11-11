// Bramy GSM (prośba 11.11.2026): numer telefonu klienta dopisywany do sterownika bramy SMS-em z poleceniem.
// Wariant A: aplikacja przygotowuje SMS (link sms:), wysyła się go z telefonu jednym dotknięciem „Wyślij”.
// Czyste funkcje (tests/bramy.test.js). Dane sterowników (numer SIM, hasło, szablony) – tabela gates (migracja 012).

import { dodajDni } from './utils.js';

/** Rzędy R1–R4 (garaże i kontenery) → brama 1, boxy → brama 2. */
export function bramaJednostki(j) {
  return j?.type === 'box_duzy' || j?.type === 'box_maly' ? 2 : 1;
}

/** Ile dni po końcu najmu (koniec okresu wypowiedzenia) numer zostaje w bramie. */
export const DNI_PO_KONCU = 3;

export const DOMYSLNE_POLECENIE_DODANIA = '{haslo}#TEL#{telefon}#{pozycja}#';
export const DOMYSLNA_WIADOMOSC = 'Dzień dobry! Numer {telefon} ma już dostęp do bramy {brama}. '
  + 'Aby otworzyć bramę, zadzwoń z tego numeru na {numer_bramy}. Pozdrawiamy';

/** „600 100 200”, „+48600100200”, „0048 600-100-200” → „+48600100200”; null, gdy to nie polski numer komórkowy. */
export function telefonMiedzynarodowy(tekst) {
  const cyfry = String(tekst ?? '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (/^\d{9}$/.test(cyfry)) return `+48${cyfry}`;
  if (/^\+48\d{9}$/.test(cyfry)) return cyfry;
  if (/^48\d{9}$/.test(cyfry)) return `+${cyfry}`;
  return null;
}

/** Podstawia {pole} w szablonie; nieznane pola zostają bez zmian. */
export function wypelnij(szablon, wartosci) {
  return String(szablon ?? '').replace(/\{([a-z0-9_]+)\}/gi, (cale, k) => (wartosci[k] != null ? String(wartosci[k]) : cale));
}

/** Treść polecenia dodania numeru do sterownika. */
export function polecenieDodania(brama, { telefon, pozycja }) {
  return wypelnij(brama.add_template || DOMYSLNE_POLECENIE_DODANIA,
    { haslo: brama.password ?? '', telefon, telefon9: telefon?.slice(-9), pozycja: pozycja ?? '' });
}

/** Treść polecenia usunięcia; null, gdy w bazie nie ma szablonu (remove_template). */
export function polecenieUsuniecia(brama, { telefon, pozycja }) {
  if (!brama.remove_template) return null;
  return wypelnij(brama.remove_template,
    { haslo: brama.password ?? '', telefon, telefon9: telefon?.slice(-9), pozycja: pozycja ?? '' });
}

/** SMS do klienta po przypisaniu. */
export function wiadomoscDlaKlienta(brama, { telefon }) {
  return wypelnij(brama.client_message || DOMYSLNA_WIADOMOSC,
    { telefon, brama: brama.numer, nazwa_bramy: brama.nazwa || `Brama ${brama.numer}`, numer_bramy: brama.sim_phone });
}

/**
 * Link otwierający Wiadomości z gotową treścią. iPhone: sms:NUMER&body=…, Android i inne: sms:NUMER?body=….
 * @param {boolean} ios
 */
export function linkSms(numer, tresc, ios) {
  return `sms:${String(numer ?? '').replace(/[^\d+]/g, '')}${ios ? '&' : '?'}body=${encodeURIComponent(tresc)}`;
}

/** iPhone / iPad (także iPad z widokiem „komputerowym”, który przedstawia się jako Mac). */
export const czyIos = (ua = globalThis.navigator?.userAgent ?? '', dotyk = globalThis.navigator?.maxTouchPoints ?? 0) =>
  /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && dotyk > 1);

/** Pierwsza wolna pozycja w sterowniku od first_slot (pozycje usuniętych numerów wracają do puli). */
export function wolnaPozycja(brama, dostepy) {
  const zajete = new Set(dostepy.filter((d) => d.gate_id === brama.id && !d.removed_on && d.slot != null).map((d) => d.slot));
  for (let p = brama.first_slot ?? 200; brama.max_slot == null || p <= brama.max_slot; p++) {
    if (!zajete.has(p)) return p;
  }
  return null;
}

/**
 * Stan bram jednego klienta: dla każdej bramy, do której prowadzą jego najmy (trwające i przyszłe) albo do której
 * ma dostęp – czy potrzebuje dostępu, aktywny dostęp i od kiedy numer należy usunąć.
 * Koniec najmu = koniec okresu wypowiedzenia albo data końca; numer usuwamy DNI_PO_KONCU dni później,
 * dopiero gdy żaden najem klienta za tą bramą nie trwa dłużej.
 * @returns {Array<{ numer, brama, najmy, dostep, potrzebna, usunOd }>}
 *   usunOd – data, od której numer należy usunąć (null – najem trwa bez daty końca)
 */
export function stanBramKlienta({ dane, indeksy }, klientId, dzis) {
  const najmy = indeksy.najmyKlienta.get(klientId) ?? [];
  const dostepy = (dane.gate_access ?? []).filter((d) => d.client_id === klientId && !d.removed_on);
  const bramy = dane.gates ?? [];
  const numery = new Set([
    ...najmy.map((n) => bramaJednostki(indeksy.jednostki.get(n.unit_id))),
    ...dostepy.map((d) => bramy.find((b) => b.id === d.gate_id)?.numer).filter(Boolean),
  ]);
  return [...numery].sort().map((numer) => {
    const brama = bramy.find((b) => b.numer === numer) ?? null;
    const zaBrama = najmy.filter((n) => bramaJednostki(indeksy.jednostki.get(n.unit_id)) === numer);
    const konce = zaBrama.map((n) => n.notice_end_on ?? n.end_on ?? null);
    const koniec = konce.length && konce.every(Boolean) ? konce.sort().at(-1) : null;
    const usunOd = konce.length ? (koniec ? dodajDni(koniec, DNI_PO_KONCU) : null) : dzis;   // bez najmów – od razu
    const dostep = brama ? dostepy.find((d) => d.gate_id === brama.id) ?? null : null;
    const potrzebna = !dostep && zaBrama.length > 0 && (usunOd == null || usunOd > dzis);
    return { numer, brama, najmy: zaBrama, dostep, potrzebna, usunOd };
  });
}

/**
 * Lista do zrobienia dla wszystkich klientów (Pulpit, ekran Bramy):
 * doPrzypisania – klient ma najem za bramą, a nie ma dostępu; doUsuniecia – ma dostęp, a termin usunięcia minął.
 */
export function bramyDoZrobienia(s, dzis) {
  const doPrzypisania = [];
  const doUsuniecia = [];
  const klienci = new Set([...s.indeksy.najmyKlienta.keys(), ...(s.dane.gate_access ?? []).map((d) => d.client_id)]);
  for (const id of klienci) {
    const k = s.indeksy.klienci.get(id);
    if (!k) continue;
    for (const b of stanBramKlienta(s, id, dzis)) {
      if (b.potrzebna) doPrzypisania.push({ klient: k, ...b });
      else if (b.dostep && b.usunOd && b.usunOd <= dzis) doUsuniecia.push({ klient: k, ...b });
    }
  }
  const poNazwie = (a, b) => a.klient.name.localeCompare(b.klient.name, 'pl') || a.numer - b.numer;
  return { doPrzypisania: doPrzypisania.sort(poNazwie), doUsuniecia: doUsuniecia.sort((a, b) => a.usunOd.localeCompare(b.usunOd) || poNazwie(a, b)) };
}
