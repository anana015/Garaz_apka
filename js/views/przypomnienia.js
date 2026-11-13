// Przypomnienia zbiorcze (0.24.0): wszyscy zalegający na jednej liście – SMS / e-mail z gotowym tekstem i „Zapisz jako wysłane”.
// Adres: #/przypomnienia (filtr „Do przypomnienia” – bez przypomnienia od DNI_MIEDZY dni, albo „Wszyscy zalegający”).
// Tekst jak na karcie klienta (przypomnienie.js); zapis = notatka w historii kontaktu (client_notes, kind sms / email).

import { czyIos, linkSms, telefonMiedzynarodowy } from '../bramy.js';
import { filtry, pustyStan } from '../ui.js';
import { dodajDni, dzisiaj, esc, etykietaMiesiaca, formatData, formatZl, odmiana } from '../utils.js';
import { ostatniePrzypomnienie, PREFIKS_PRZYPOMNIENIA } from '../zadania.js';
import { danePrzypomnienia, tekstPrzypomnienia } from './przypomnienie.js';
import { rozliczeniaKlientow } from './wspolne.js';

/** Po ilu dniach od ostatniego przypomnienia klient wraca na listę „Do przypomnienia”. */
export const DNI_MIEDZY = 7;

const FILTRY = { 'do-przypomnienia': 'Do przypomnienia', wszyscy: 'Wszyscy zalegający' };

/**
 * Zalegający klienci (dłużnicy z rozliczenia, z tolerancją z Ustawień), od najstarszej zaległości.
 * @returns {Array<{ klient, d, r, ostatnie: string|null, doPrzypomnienia: boolean }>}
 */
export function zalegajacy(s, dzis = dzisiaj()) {
  const wynik = [];
  for (const [klientId, r] of rozliczeniaKlientow(s)) {
    const klient = s.indeksy.klienci.get(klientId);
    if (!klient || klient.archived || !r.dluznik) continue;
    const d = danePrzypomnienia(s, klient, dzis);
    if (d.kwotaGr <= 0) continue;
    const ostatnie = ostatniePrzypomnienie(s.dane.client_notes, klientId);
    wynik.push({ klient, d, r, ostatnie, doPrzypomnienia: !ostatnie || ostatnie <= dodajDni(dzis, -DNI_MIEDZY) });
  }
  return wynik.sort((a, b) => b.r.dniPoTerminie - a.r.dniPoTerminie || b.d.kwotaGr - a.d.kwotaGr);
}

/** Ilu zalegających nie dostało przypomnienia od dnia `od` (miesięczny przegląd: od terminu miesiąca). */
export const bezPrzypomnieniaOd = (s, od, dzis = dzisiaj()) => zalegajacy(s, dzis).filter((x) => !x.ostatnie || x.ostatnie < od).length;

function wiersz(x, s) {
  const { klient, d, r, ostatnie } = x;
  const id = esc(klient.id);
  const telefon = telefonMiedzynarodowy(klient.phone);
  const otwarte = s.ui.przypomnienia?.[klient.id];
  const miesiace = [...d.miesiace.keys()].sort()
    .map((k) => `<span class="chip">${esc(k === 'otwarcie' ? 'saldo otwarcia' : etykietaMiesiaca(k))}</span>`).join('');
  return `<li class="przypomnienie${otwarte ? ' otwarte' : ''}">
    <div class="wiersz">
      <a class="glowna" href="#/klienci/${encodeURIComponent(klient.id)}">
        <strong>${esc(klient.name)}</strong>
        <span>${d.kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('')} ${miesiace}</span>
        <span>${ostatnie ? `ostatnie przypomnienie ${formatData(ostatnie)}` : 'bez przypomnienia'}</span>
      </a>
      <div class="prawa"><div class="kwota">${formatZl(d.kwotaGr)}</div>
        <div class="maly"><span class="status zalega">${r.dniPoTerminie} ${r.dniPoTerminie === 1 ? 'dzień' : 'dni'} po terminie</span></div></div>
    </div>
    <div class="pasek-akcji wiersz-akcji">
      ${telefon ? `<button type="button" class="przycisk maly" data-akcja="zbiorczo-sms" data-id="${id}">SMS</button>` : ''}
      ${klient.email ? `<button type="button" class="przycisk drugi maly" data-akcja="zbiorczo-email" data-id="${id}">E-mail</button>` : ''}
      ${!telefon && !klient.email ? '<span class="podpowiedz">Brak telefonu i e-maila – zadzwoń albo uzupełnij dane.</span>' : ''}
      <button type="button" class="przycisk ${otwarte ? '' : 'drugi '}maly" data-akcja="zbiorczo-wyslane" data-id="${id}"
        data-kanal="${otwarte ?? (telefon ? 'sms' : 'email')}">${otwarte ? 'Wysłane – zapisz' : 'Zapisz jako wysłane'}</button>
      <a class="link-btn maly" href="#/klienci/${encodeURIComponent(klient.id)}/przypomnienie">Zmień tekst</a>
    </div>
  </li>`;
}

export default {
  zakladka: 'klienci',
  tytul: () => 'Przypomnienia o płatności',
  wstecz: () => ({ href: '#/pulpit', tekst: 'Pulpit' }),

  render(s) {
    const dzis = dzisiaj();
    const filtr = s.ui.filtry.przypomnienia ?? 'do-przypomnienia';
    const wszyscy = zalegajacy(s, dzis);
    const lista = filtr === 'wszyscy' ? wszyscy : wszyscy.filter((x) => x.doPrzypomnienia);
    const opcje = Object.entries(FILTRY).map(([id, tekst]) => ({
      id, tekst, liczba: id === 'wszyscy' ? wszyscy.length : wszyscy.filter((x) => x.doPrzypomnienia).length,
    }));
    const suma = lista.reduce((a, x) => a + x.d.kwotaGr, 0);
    const naglowek = `${filtry(opcje, filtr, 'Którzy klienci')}
      <p class="podpowiedz">„SMS” i „E-mail” otwierają Wiadomości / Pocztę z gotowym tekstem – dotknij „Wyślij”, wróć i zapisz
        jako wysłane. Klient wraca na listę „Do przypomnienia” po ${DNI_MIEDZY} dniach.</p>`;
    if (!lista.length) {
      return naglowek + pustyStan(wszyscy.length ? 'Wszyscy zalegający dostali już przypomnienie.' : 'Nikt nie zalega.',
        [{ tekst: 'Pulpit', href: '#/pulpit' }]);
    }
    return `${naglowek}
      <p><strong>${odmiana(lista.length, ['klient', 'klientów', 'klientów'])}</strong> · razem <span class="kwota"><strong>${formatZl(suma)}</strong></span></p>
      <section class="karta szeroka"><ul class="lista">${lista.map((x) => wiersz(x, s)).join('')}</ul></section>`;
  },

  akcje: {
    /** Otwiera Wiadomości od razu w dotknięciu (bez await), potem wiersz czeka na „Wysłane – zapisz”. */
    'zbiorczo-sms'(el, ctx) {
      const s = ctx.state;
      const k = s.indeksy.klienci.get(el.dataset.id);
      const t = telefonMiedzynarodowy(k?.phone);
      if (!t) return;
      (s.ui.przypomnienia ??= {})[k.id] = 'sms';
      location.href = linkSms(t, tekstPrzypomnienia(k, danePrzypomnienia(s, k)), czyIos());
      ctx.render();
    },
    'zbiorczo-email'(el, ctx) {
      const s = ctx.state;
      const k = s.indeksy.klienci.get(el.dataset.id);
      if (!k?.email) return;
      (s.ui.przypomnienia ??= {})[k.id] = 'email';
      location.href = `mailto:${encodeURIComponent(k.email)}?subject=${encodeURIComponent('Przypomnienie o płatności')}&body=${
        encodeURIComponent(tekstPrzypomnienia(k, danePrzypomnienia(s, k)))}`;
      ctx.render();
    },
    async 'zbiorczo-wyslane'(el, ctx) {
      const s = ctx.state;
      const k = s.indeksy.klienci.get(el.dataset.id);
      if (!k) return;
      if (s.podglad || s.offline || s.zKopii) { ctx.toast('Zapis wymaga połączenia z bazą.'); return; }
      const d = danePrzypomnienia(s, k);
      el.disabled = true;
      try {
        const n = await ctx.db.wstaw('client_notes', {
          client_id: k.id, kind: el.dataset.kanal === 'email' ? 'email' : 'sms',
          body: `${PREFIKS_PRZYPOMNIENIA} (${formatZl(d.kwotaGr)}): ${tekstPrzypomnienia(k, d).slice(0, 900)}`,
        });
        ctx.scal({ client_notes: [n] });
        delete s.ui.przypomnienia?.[k.id];
        ctx.toast(`Zapisano przypomnienie: ${k.name}`);
        ctx.render();
        document.querySelector('#widok [data-akcja="zbiorczo-sms"], #widok [data-akcja="zbiorczo-email"]')?.focus();
      } catch (e) {
        el.disabled = false;
        ctx.toast(e.message);
      }
    },
  },
};
