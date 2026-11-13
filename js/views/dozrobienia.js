// „Do zrobienia” (0.24.0, od 0.25.0 w zakładce Zadania – prośba 13.11.2026: nie na Pulpicie).
// Jedna lista od najpilniejszego, każda pozycja z przyciskiem akcji. Pilność: 0 – po terminie / pilne, 1 – na dziś,
// 2 – wkrótce, 3 – do wiadomości. Zadania (notatki z terminem) są w tej samej zakładce niżej, więc tu ich nie ma
// (opcja zZadaniami – licznik zakładki).

import { DNI_BEZ_IMPORTU } from '../config.js';
import { krokiMiesiaca, postep, reczneKroki } from '../kreator.js';
import { biezacyNajem, doPrzypisania } from '../dane.js';
import { zadania } from '../zadania.js';
import { bramyDoZrobienia } from '../bramy.js';
import { doRozliczenia, kwartalDoRozliczenia } from '../prad.js';
import { limityVat, PROGI_VAT } from '../statystyki.js';
import { etykietaKwartalu, GRUPY_RYCZALTU, kwartalyDoZaplaty, nazwaGrupy } from '../podatek.js';
import { dodajDni, esc, dzisiaj, etykietaMiesiaca, formatZl, formatData, kluczMiesiaca, odmiana, roznicaDni } from '../utils.js';
import { koniecUmowy } from './jednostki.js';
import { zalegajacy } from './przypomnienia.js';
import { ustawienia } from './wspolne.js';

const dni = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

// ---------------------------------------------------------------------
// „Do zrobienia” (0.24.0): jedna lista zamiast pasków – od najpilniejszego, każda pozycja z przyciskiem akcji.
// Pilność: 0 – po terminie / pilne, 1 – na dziś, 2 – wkrótce, 3 – do wiadomości.
// ---------------------------------------------------------------------

const POKAZ_OD_RAZU = 7;
const ETYKIETY_PILNOSCI = ['pilne', 'dziś', 'wkrótce', 'info'];
const KLASY_PILNOSCI = ['zalega', 'czesciowo', 'zajeta', 'wylaczona'];

const link = (tekst, href, drugi = false) => `<a class="przycisk maly${drugi ? ' drugi' : ''}" href="${esc(href)}">${esc(tekst)}</a>`;
const idz = (tekst, ekran, filtr, drugi = false) => `<button type="button" class="przycisk maly${drugi ? ' drugi' : ''}" data-akcja="idz"
  data-ekran="${esc(ekran)}"${filtr ? ` data-filtr="${esc(filtr)}"` : ''}>${esc(tekst)}</button>`;

/** Zebrane pozycje „Do zrobienia”, posortowane od najpilniejszej. */
export function doZrobienia(s, dzis = dzisiaj(), { zZadaniami = false } = {}) {
  const lista = [];
  const dodaj = (pilnosc, tytul, opis, akcje) => lista.push({ pilnosc, tytul, opis, akcje });

  // Zadania (notatki z terminem): każde osobno, z „Zrobione”.
  const zadaniaPilne = !zZadaniami ? [] : zadania(s.dane.client_notes).filter((n) => n.promised_on <= dzis)
    .sort((a, b) => a.promised_on.localeCompare(b.promised_on));
  for (const n of zadaniaPilne.slice(0, 5)) {
    const klient = s.indeksy.klienci.get(n.client_id);
    const po = roznicaDni(n.promised_on, dzis);
    dodaj(po > 0 ? 0 : 1, `${esc(klient?.name ?? 'Klient')}: ${esc(n.body.length > 80 ? `${n.body.slice(0, 80)}…` : n.body)}`,
      po > 0 ? `zadanie ${dni(po)} po terminie` : 'zadanie na dziś',
      `<button type="button" class="przycisk maly" data-akcja="zadanie-zrobione" data-id="${esc(n.id)}" data-zrobione="1">Zrobione</button>
       ${link('Karta klienta', `#/klienci/${encodeURIComponent(n.client_id)}`, true)}`);
  }
  if (zadaniaPilne.length > 5) {
    dodaj(1, `I jeszcze ${odmiana(zadaniaPilne.length - 5, ['zadanie', 'zadania', 'zadań'])} na dziś i po terminie`, '',
      idz('Zadania', 'zadania', 'do-zrobienia'));
  }

  // Bramy: numery do usunięcia (koniec najmu + 3 dni) – każdy osobno; do przypisania – osobno albo zbiorczo.
  if (s.dane.gates?.length) {
    const b = bramyDoZrobienia(s, dzis);
    for (const x of b.doUsuniecia) {
      dodaj(0, `Usuń z bramy ${x.numer}: ${esc(x.klient.name)}`,
        `numer ${esc(x.dostep.phone)}${x.dostep.slot != null ? `, pozycja ${x.dostep.slot}` : ''} – od ${formatData(x.usunOd)}`,
        link('Usuń z bramy', `#/bramy/${encodeURIComponent(x.klient.id)}?brama=${x.numer}`));
    }
    const nowe = b.doPrzypisania.filter((x) => x.najmy.some((n) => n.start_on <= dodajDni(dzis, 7)));
    if (nowe.length > 3) {
      dodaj(2, `Bramy: ${odmiana(nowe.length, ['numer czeka', 'numery czekają', 'numerów czeka'])} na przypisanie`,
        'klienci z najmem bez dostępu do bramy', link('Bramy', '#/bramy'));
    } else {
      for (const x of nowe) {
        dodaj(1, `Przypisz do bramy ${x.numer}: ${esc(x.klient.name)}`, 'najem bez dostępu do bramy',
          link('Przypisz', `#/bramy/${encodeURIComponent(x.klient.id)}?brama=${x.numer}`));
      }
    }
  }

  // Najmy do zakończenia: po dacie końca bez „Zakończ najem” – pilne; w ciągu 7 dni – wkrótce. Akcja: kreator końca.
  for (const n of s.dane.rentals) {
    const koniec = n.end_on ? null : n.notice_end_on ?? null;
    if (!koniec || koniec > dodajDni(dzis, 7)) continue;
    const klient = s.indeksy.klienci.get(s.indeksy.umowy.get(n.contract_id)?.client_id);
    const kod = s.indeksy.jednostki.get(n.unit_id)?.code ?? '?';
    const minelo = koniec < dzis;
    dodaj(minelo ? 0 : 2, `${minelo ? 'Zakończ najem' : 'Kończy się najem'} ${esc(kod)} · ${esc(klient?.name ?? '—')}`,
      `koniec najmu ${formatData(koniec)}${minelo ? '' : koniec === dzis ? ' (dziś)' : ` (za ${dni(roznicaDni(dzis, koniec))})`}`,
      link('Krok po kroku', `#/kreator/koniec/${encodeURIComponent(n.id)}`, !minelo));
  }

  // Wpłaty do przypisania – zbiorczo, „Przypisz” otwiera najstarszą.
  const nieprzypisane = doPrzypisania(s.dane.payments).sort((a, b) => a.booked_on.localeCompare(b.booked_on));
  if (nieprzypisane.length) {
    dodaj(1, `${odmiana(nieprzypisane.length, ['wpłata czeka', 'wpłaty czekają', 'wpłat czeka'])} na przypisanie`,
      `najstarsza z ${formatData(nieprzypisane[0].booked_on)}`,
      `${nieprzypisane[0].method === 'przelew' ? link('Przypisz', `#/wplaty/${encodeURIComponent(nieprzypisane[0].id)}/przypisz`) : ''}
       ${idz('Lista', 'wplaty', 'do-przypisania', true)}`);
  }

  // Zalegający bez przypomnienia od 7 dni.
  const zalegli = zalegajacy(s, dzis);
  const bezPrzyp = zalegli.filter((x) => x.doPrzypomnienia);
  if (bezPrzyp.length) {
    const kwota = bezPrzyp.reduce((a, x) => a + x.d.kwotaGr, 0);
    dodaj(1, `${odmiana(bezPrzyp.length, ['klient zalega', 'klientów zalega', 'klientów zalega'])} – wyślij przypomnienia`,
      `razem ${formatZl(kwota, { grosze: false })}`, link('Przypomnij', '#/przypomnienia'));
  }

  // Miesięczny przegląd – od 20. dnia (termin płatności), dopóki nie wszystko zrobione.
  const u = ustawienia(s);
  const dzien = Number(u.default_billing_day) || 20;
  if (Number(dzis.slice(8, 10)) >= dzien) {
    const m = kluczMiesiaca(dzis);
    const termin = `${m}-${String(dzien).padStart(2, '0')}`;
    const p = postep(krokiMiesiaca(s, { miesiac: m, dzis, reczne: reczneKroki(`miesiac:${m}`), terminDzien: dzien,
      doPrzypomnienia: zalegli.filter((x) => !x.ostatnie || x.ostatnie < termin).length }));
    if (p.gotowe < p.razem) {
      dodaj(2, `Miesięczny przegląd: ${esc(etykietaMiesiaca(m))}`, `${p.gotowe} z ${p.razem} kroków gotowe`,
        link('Otwórz', '#/kreator/miesiac'));
    }
  }

  // Prąd: od 7 dni przed końcem kwartału do 30 dni po nim.
  if (s.dane.units.some((j) => j.has_power)) {
    const kw = kwartalDoRozliczenia(dzis);
    const brak = dzis >= dodajDni(kw.do, -7) ? doRozliczenia(s.dane, s.indeksy, kw) : [];
    if (brak.length) {
      dodaj(dzis > kw.do ? 1 : 2, `Prąd ${esc(kw.nazwa)}: ${odmiana(brak.length, ['jednostka czeka', 'jednostki czekają', 'jednostek czeka'])} na odczyt licznika`,
        '', link('Odczyty', '#/prad'));
    }
  }

  // Ryczałt: po terminie – pilne; najbliższy do zapłaty – na 7 dni przed terminem „dziś”, wcześniej „wkrótce”.
  const ryczalt = kwartalyDoZaplaty(s.dane, { dzis, ustawienia: u });
  for (const g of GRUPY_RYCZALTU) {
    const wGrupie = ryczalt.filter((k) => k.grupa === g.id);
    const zalegle = wGrupie.filter((k) => k.status !== 'do_zaplaty');
    if (zalegle.length) {
      const k = zalegle[0];
      dodaj(0, `Ryczałt (${esc(g.nazwa)}) po terminie lub niedopłacony`, esc(zalegle.map((x) => `${etykietaKwartalu(x.q)} ${x.rok}`).join(', ')),
        link('Wpisz wpłatę', `#/raporty/ryczalt/${k.rok}-${k.q}-${g.id}`));
    }
    const k = wGrupie.find((x) => x.status === 'do_zaplaty');
    if (k) {
      dodaj(roznicaDni(dzis, k.termin) <= 7 ? 1 : 2, `Ryczałt (${esc(nazwaGrupy(g.id))}) za ${etykietaKwartalu(k.q)} ${k.rok}: ${formatZl(k.doZaplatyGr, { grosze: false })}`,
        `do zapłaty do ${formatData(k.termin)}`, link('Szczegóły', `#/raporty/ryczalt/${k.rok}-${k.q}-${g.id}`, true));
    }
  }

  // Limity VAT: od 80% – wkrótce, od 95% i po przekroczeniu – pilne.
  for (const l of limityVat(s.dane, { rok: Number(dzis.slice(0, 4)), dzis, limitGr: u.vat_limit_gr })) {
    if (l.udzial < PROGI_VAT[0] && !l.przekroczono) continue;
    dodaj(l.przekroczono || l.udzial >= PROGI_VAT[1] ? 0 : 2, l.przekroczono
      ? `Limit VAT przekroczony (${esc(l.nazwa)}) ${formatData(l.dataPrzekroczenia)}`
      : `Limit VAT – ${esc(l.nazwa)}: ${Math.round(l.udzial * 100)}% z ${formatZl(l.limitGr, { grosze: false })}`, '', idz('Raporty', 'raporty', null, true));
  }

  // Umowy na czas określony kończące się w ciągu settings.expiring_days dni albo wygasłe (Z10).
  const konczace = s.dane.units.filter((j) => !j.archived).filter((j) => {
    const najem = biezacyNajem(s.indeksy.najmyJednostki.get(j.id), dzis);
    return najem && koniecUmowy(s.indeksy.umowy.get(najem.contract_id), najem, s, dzis);
  }).length;
  if (konczace) {
    dodaj(2, `Umowy kończące się w ciągu ${u.expiring_days} dni lub wygasłe: ${konczace}`, '', idz('Pokaż', 'jednostki', 'konczace', true));
  }

  // Konta bez importu od DNI_BEZ_IMPORTU dni (albo jeszcze bez żadnego wyciągu).
  for (const konto of s.dane.bank_accounts.filter((k) => !k.archived)) {
    const ostatni = s.dane.imports.filter((i) => i.bank_account_id === konto.id)
      .reduce((m, i) => (i.imported_at > m ? i.imported_at : m), '');
    const ile = ostatni ? roznicaDni(ostatni.slice(0, 10), dzis) : null;
    if (ile == null || ile >= DNI_BEZ_IMPORTU) {
      dodaj(3, ile == null ? `Nie wczytano jeszcze wyciągu z konta ${esc(konto.name)}` : `Brak importu z konta ${esc(konto.name)} od ${ile} dni`,
        '', link('Import', '#/import', true));
    }
  }

  return lista.map((x, i) => ({ ...x, i })).sort((a, b) => a.pilnosc - b.pilnosc || a.i - b.i);
}

function pozycja(x) {
  return `<li class="do-zrobienia-pozycja p${x.pilnosc}">
    <span class="status ${KLASY_PILNOSCI[x.pilnosc]}"><span class="sr-only">${ETYKIETY_PILNOSCI[x.pilnosc]}: </span></span>
    <div class="glowna"><strong>${x.tytul}</strong>${x.opis ? `<span>${x.opis}</span>` : ''}</div>
    <div class="akcje">${x.akcje}</div></li>`;
}

/** Karta „Do zrobienia” na górze zakładki Zadania. */
export function kartaDoZrobienia(s) {
  const lista = doZrobienia(s);
  const pilne = lista.filter((x) => x.pilnosc === 0).length;
  const naglowek = `<h2 id="k-do-zrobienia">Do zrobienia ${lista.length ? `<span class="liczba-pozycji">${lista.length}</span>` : ''}${
    pilne ? ` <span class="status zalega maly">${odmiana(pilne, ['pilne', 'pilne', 'pilnych'])}</span>` : ''}</h2>`;
  if (!lista.length) {
    return `<section class="karta szeroka do-zrobienia" aria-labelledby="k-do-zrobienia">${naglowek}
      <p class="wyciszony"><span class="status ok">Wszystko zrobione</span> – nic nie czeka.</p></section>`;
  }
  const reszta = lista.slice(POKAZ_OD_RAZU);
  return `<section class="karta szeroka do-zrobienia" aria-labelledby="k-do-zrobienia">${naglowek}
    <ul class="lista">${lista.slice(0, POKAZ_OD_RAZU).map(pozycja).join('')}</ul>
    ${reszta.length ? `<details class="wiecej-pozycji"><summary>Pokaż jeszcze ${reszta.length}</summary>
      <ul class="lista">${reszta.map(pozycja).join('')}</ul></details>` : ''}</section>`;
}

