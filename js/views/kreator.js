// Kreatory (0.24.0) – lista kroków z postępem; każdy krok prowadzi do istniejącego formularza, a po zapisie
// formularz wraca tutaj (app.js → powrotDoKreatora). Na innych ekranach pasek „Wróć do kreatora”.
//   #/kreator/klient[?klient=<id>&najem=<id>]  – nowy klient: dane, najem, umowa, brama, kaucja
//   #/kreator/koniec/<id najmu>               – zakończenie najmu: wypowiedzenie, prąd, koniec i kaucja, brama
//   #/kreator/miesiac[?m=RRRR-MM]             – miesięczny przegląd: wyciągi, przypisanie, przypomnienia, koszty, zadania

import {
  krokiKonca, krokiMiesiaca, krokiNowegoKlienta, miesiacPrzegladu, oznaczKrok, postep, reczneKroki, STANY, ustawKreator,
} from '../kreator.js';
import { pustyStan } from '../ui.js';
import { dzisiaj, esc, etykietaMiesiaca, kluczMiesiaca } from '../utils.js';
import { bezPrzypomnieniaOd } from './przypomnienia.js';
import { wzoryUmow } from './umowy.js';
import { pasekPostepu, ustawienia } from './wspolne.js';

const OPIS_STANU = {
  [STANY.zrobione]: { tekst: 'zrobione', klasa: 'ok' },
  [STANY.doZrobienia]: { tekst: 'do zrobienia', klasa: 'czesciowo' },
  [STANY.pominiete]: { tekst: 'pominięte', klasa: 'wylaczona' },
  [STANY.pozniej]: { tekst: 'później', klasa: 'zajeta' },
  [STANY.czeka]: { tekst: 'czeka na poprzedni krok', klasa: 'wylaczona' },
};

/** Typ, klucz ręcznych znaczników, tytuł, kroki i adres powrotu po zakończeniu. */
function kontekst(s) {
  const { parametr, akcja, zapytanie } = s.ui;
  const dzis = dzisiaj();
  if (parametr === 'koniec') {
    const najem = s.dane.rentals.find((n) => n.id === akcja);
    if (!najem) return null;
    const klient = s.indeksy.klienci.get(s.indeksy.umowy.get(najem.contract_id)?.client_id);
    const kod = s.indeksy.jednostki.get(najem.unit_id)?.code ?? '';
    const klucz = `koniec:${najem.id}`;
    return {
      typ: 'koniec', klucz, najemId: najem.id, tytul: `Zakończenie najmu ${kod}`, podtytul: klient?.name ?? '',
      kroki: krokiKonca(s, najem.id, dzis, reczneKroki(klucz)),
      koniec: klient ? `#/klienci/${encodeURIComponent(klient.id)}` : '#/pulpit',
    };
  }
  if (parametr === 'miesiac') {
    const m = /^\d{4}-\d{2}$/.test(zapytanie.m ?? '') ? zapytanie.m : miesiacPrzegladu(dzis);
    const dzien = Number(ustawienia(s).default_billing_day) || 20;
    const termin = `${m}-${String(dzien).padStart(2, '0')}`;
    const klucz = `miesiac:${m}`;
    return {
      typ: 'miesiac', klucz, miesiac: m, tytul: `Miesięczny przegląd: ${etykietaMiesiaca(m)}`, podtytul: '',
      kroki: krokiMiesiaca(s, { miesiac: m, dzis, reczne: reczneKroki(klucz), terminDzien: dzien,
        doPrzypomnienia: dzis >= termin ? bezPrzypomnieniaOd(s, termin, dzis) : 0 }),
      koniec: '#/pulpit',
    };
  }
  // Nowy klient
  const klientId = s.indeksy.klienci.has(zapytanie.klient) ? zapytanie.klient : null;
  const najemId = klientId && s.dane.rentals.some((n) => n.id === zapytanie.najem) ? zapytanie.najem : null;
  const klucz = `klient:${najemId ?? klientId ?? 'nowy'}`;
  return {
    typ: 'klient', klucz, najemId, tytul: 'Nowy klient – krok po kroku', podtytul: klientId ? s.indeksy.klienci.get(klientId).name : '',
    kroki: krokiNowegoKlienta(s, { klientId, najemId, reczne: reczneKroki(klucz), mamWzory: wzoryUmow(s).length > 0 }, dzis),
    koniec: klientId ? `#/klienci/${encodeURIComponent(klientId)}` : '#/klienci',
  };
}

function przyciskKroku(k, glowny) {
  if (k.stan === STANY.czeka || k.stan === STANY.zrobione && !k.href && !k.idz) return '';
  const klasa = `przycisk maly${glowny ? '' : ' drugi'}`;
  if (k.idz) {
    return `<button type="button" class="${klasa}" data-akcja="idz" data-ekran="${esc(k.idz.ekran)}" data-filtr="${esc(k.idz.filtr)}">${esc(k.tekst)}</button>`;
  }
  return k.href ? `<a class="${klasa}" href="${esc(k.href)}">${esc(k.stan === STANY.zrobione ? 'Otwórz' : k.tekst)}</a>` : '';
}

function listaKrokow(kroki, nastepny) {
  return `<ol class="kroki">${kroki.map((k, i) => {
    const o = OPIS_STANU[k.stan];
    const reczny = k.reczny && k.stan !== STANY.czeka
      ? `<button type="button" class="przycisk maly drugi" data-akcja="krok-reczny" data-krok="${esc(k.id)}" data-zrobiony="${
        k.stan === STANY.zrobione ? '' : '1'}">${k.stan === STANY.zrobione ? 'Cofnij odhaczenie' : 'Odhacz jako zrobione'}</button>` : '';
    const pomin = k.pomin ? `<button type="button" class="przycisk maly drugi" data-akcja="krok-reczny" data-krok="${esc(k.id)}" data-zrobiony="1">Bez kaucji – pomiń</button>` : '';
    return `<li class="krok ${esc(k.stan)}${k === nastepny ? ' nastepny' : ''}"${k === nastepny ? ' aria-current="step"' : ''}>
      <span class="numer" aria-hidden="true">${k.stan === STANY.zrobione ? '✓' : i + 1}</span>
      <div class="tresc-kroku">
        <h3>${esc(k.nazwa)} <span class="status ${o.klasa}">${o.tekst}</span></h3>
        <p class="wyciszony">${esc(k.opis)}</p>
        <div class="pasek-akcji">${przyciskKroku(k, k === nastepny)}${reczny}${pomin}</div>
      </div></li>`;
  }).join('')}</ol>`;
}

export default {
  zakladka: (s) => (s.ui.parametr === 'miesiac' ? 'pulpit' : 'klienci'),
  tytul: (s) => kontekst(s)?.tytul ?? 'Kreator',
  wstecz: (s) => ({ href: kontekst(s)?.koniec ?? '#/pulpit', tekst: 'Wyjdź' }),

  render(s) {
    const k = kontekst(s);
    if (!k) return pustyStan('Nie znaleziono najmu.', [{ tekst: 'Pulpit', href: '#/pulpit' }]);
    const p = postep(k.kroki);
    const gotowe = p.gotowe === p.razem;
    const miesiace = k.typ === 'miesiac' ? (() => {
      const [y, m] = k.miesiac.split('-').map(Number);
      const poprz = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      const nast = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      return `<p class="maly"><a href="#/kreator/miesiac?m=${poprz}">‹ ${esc(etykietaMiesiaca(poprz))}</a>${
        nast <= kluczMiesiaca(dzisiaj()) ? ` · <a href="#/kreator/miesiac?m=${nast}">${esc(etykietaMiesiaca(nast))} ›</a>` : ''}</p>`;
    })() : '';
    return `<section class="karta szeroka kreator" aria-labelledby="k-kreator">
        <h2 id="k-kreator">${esc(k.podtytul || k.tytul)}</h2>
        ${miesiace}
        <p><strong>${p.gotowe} z ${p.razem}</strong> kroków gotowe</p>
        ${pasekPostepu(p.udzial)}
        ${listaKrokow(k.kroki, p.nastepny)}
        <div class="pasek-akcji">
          ${gotowe ? `<p class="baner ok pelny-wiersz" role="status">Wszystko zrobione.</p>
            <button type="button" class="przycisk" data-akcja="zakoncz-kreator" data-href="${esc(k.koniec)}">Zakończ</button>`
    : `<button type="button" class="przycisk drugi" data-akcja="zakoncz-kreator" data-href="${esc(k.koniec)}">Wyjdź z kreatora</button>`}
        </div>
      </section>
      <p class="podpowiedz">Każdy krok otwiera zwykły formularz. Po zapisie wrócisz tutaj; z innych ekranów wrócisz paskiem
        „Wróć do kreatora”. Stan kroków liczy się z danych – kreator można przerwać i dokończyć później.</p>`;
  },

  /** Zapamiętuje kreator (pasek powrotu, przechwycenie zapisu formularza) z adresami kroków. */
  poRenderze(_root, s) {
    const k = kontekst(s);
    if (!k) return;
    const sciezki = [...new Set(k.kroki.map((x) => x.href).filter(Boolean).map((h) => h.split('?')[0]))];
    ustawKreator({ typ: k.typ, href: location.hash, nazwa: k.tytul, najemId: k.najemId ?? null, sciezki });
  },

  akcje: {
    'krok-reczny'(el, ctx) {
      const k = kontekst(ctx.state);
      if (!k) return;
      oznaczKrok(k.klucz, el.dataset.krok, el.dataset.zrobiony === '1');
      ctx.render();
    },
  },
};
