// Przypomnienie o płatności (etap 3, krok 1): tekst do skopiowania albo wysłania SMS-em / e-mailem z telefonu.
// Adres: #/klienci/<id>/przypomnienie. Kwota i miesiące z rozliczenia klienta, numer konta z „gdzie płaci” najmu.

import { czyIos, linkSms, telefonMiedzynarodowy } from '../bramy.js';
import { formularz, obszar, stanFormularza, wartosciFormularza, zapisz } from '../formularz.js';
import { pustyStan } from '../ui.js';
import { dzisiaj, etykietaMiesiaca, formatRachunek, formatZl, kluczMiesiaca, porownajKody } from '../utils.js';
import { rozliczeniaKlientow } from './wspolne.js';

/** Zaległe pozycje klienta, kwota, jednostki i konta do wpłaty. */
export function danePrzypomnienia(s, klient, dzis = dzisiaj()) {
  const r = rozliczeniaKlientow(s).get(klient.id);
  const zalegle = (r?.pozycje ?? []).filter((p) => p.termin < dzis && p.zaplaconoGr < p.kwotaGr);
  const kwotaGr = zalegle.reduce((x, p) => x + p.kwotaGr - p.zaplaconoGr, 0);
  const miesiace = new Map();
  for (const p of zalegle) {
    const k = p.otwarcie ? 'otwarcie' : kluczMiesiaca(p.termin);
    miesiace.set(k, (miesiace.get(k) ?? 0) + p.kwotaGr - p.zaplaconoGr);
  }
  const najmy = (s.indeksy.najmyKlienta.get(klient.id) ?? []).filter((n) => !n.end_on || n.end_on >= dzis);
  const kody = [...new Set(najmy.map((n) => s.indeksy.jednostki.get(n.unit_id)?.code).filter(Boolean))].sort(porownajKody);
  const konta = [...new Set(najmy.map((n) => (n.pay_method === 'przelew' ? s.indeksy.konta.get(n.bank_account_id)?.iban : null))
    .filter(Boolean))];
  return { kwotaGr, miesiace, kody, konta };
}

export function tekstPrzypomnienia(klient, d) {
  const lista = [...d.miesiace.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, gr]) => `${k === 'otwarcie' ? 'zaległość z poprzedniego okresu' : etykietaMiesiaca(k)} – ${formatZl(gr)}`).join(', ');
  const jednostki = d.kody.join(', ');
  return [
    'Dzień dobry,',
    `przypominamy o zaległej płatności za najem${jednostki ? ` ${jednostki}` : ''}: ${formatZl(d.kwotaGr)}${lista ? ` (${lista})` : ''}.`,
    d.konta.length ? `Prosimy o wpłatę na rachunek ${d.konta.map(formatRachunek).join(' lub ')}, w tytule: ${jednostki || klient.name}.`
      : 'Prosimy o uregulowanie płatności.',
    'Jeśli wpłata została już wysłana, prosimy zignorować tę wiadomość. Pozdrawiamy',
  ].join('\n');
}

export function przypomnienie(s, klient) {
  const d = danePrzypomnienia(s, klient);
  const id = encodeURIComponent(klient.id);
  if (!d.kwotaGr) return pustyStan('Klient nie ma zaległości – nie ma o czym przypominać.', [{ tekst: 'Karta klienta', href: `#/klienci/${id}` }]);
  const f = stanFormularza(s, `klienci/${klient.id}/przypomnienie`, () => ({ tresc: tekstPrzypomnienia(klient, d) }));
  const telefon = telefonMiedzynarodowy(klient.phone);
  return formularz(f, {
    nazwa: 'przypomnienie',
    przycisk: 'Zapisz w historii kontaktu',
    anuluj: `#/klienci/${id}`,
    uwaga: '',
    tresc: `<p>Zaległość: <span class="kwota"><strong>${formatZl(d.kwotaGr)}</strong></span></p>
      ${obszar(f, { nazwa: 'tresc', etykieta: 'Treść przypomnienia', wiersze: 7, maks: 1000,
    podpowiedz: 'Możesz zmienić tekst przed wysłaniem.' })}
      <div class="pasek-akcji">
        ${telefon ? '<button type="button" class="przycisk" data-akcja="przypomnienie-sms">Wyślij SMS</button>' : ''}
        ${klient.email ? '<button type="button" class="przycisk drugi" data-akcja="przypomnienie-email">Wyślij e-mail</button>' : ''}
        <button type="button" class="przycisk drugi" data-akcja="przypomnienie-kopiuj">Kopiuj tekst</button>
      </div>
      ${!telefon ? '<p class="podpowiedz">Brak poprawnego numeru telefonu klienta – SMS niedostępny.</p>' : ''}
      <p class="podpowiedz">SMS i e-mail otwierają Wiadomości / Pocztę z gotowym tekstem – dotknij „Wyślij”. Potem zapisz
        przypomnienie w historii kontaktu.</p>`,
  });
}

const tresc = () => document.getElementById('f-tresc')?.value ?? '';

/** Akcje działają od razu w dotknięciu (bez await), więc iPhone otwiera Wiadomości bez blokady. */
export const akcjePrzypomnienia = {
  'przypomnienie-sms'(_el, ctx) {
    const k = ctx.state.indeksy.klienci.get(ctx.state.ui.parametr);
    const t = telefonMiedzynarodowy(k?.phone);
    if (t) location.href = linkSms(t, tresc(), czyIos());
  },
  'przypomnienie-email'(_el, ctx) {
    const k = ctx.state.indeksy.klienci.get(ctx.state.ui.parametr);
    if (k?.email) location.href = `mailto:${encodeURIComponent(k.email)}?subject=${encodeURIComponent('Przypomnienie o płatności')}&body=${encodeURIComponent(tresc())}`;
  },
  'przypomnienie-kopiuj'(_el, ctx) {
    navigator.clipboard?.writeText(tresc()).then(() => ctx.toast('Skopiowano tekst przypomnienia'),
      () => ctx.toast('Nie udało się skopiować – zaznacz tekst i skopiuj ręcznie.'));
  },
};

export const formularzeprzypomnienia = {
  async przypomnienie(form, ctx) {
    const s = ctx.state;
    const klient = s.indeksy.klienci.get(s.ui.parametr);
    if (!klient) return;
    const w = wartosciFormularza(form);
    s.ui.form.wartosci = w;
    const d = danePrzypomnienia(s, klient);
    await zapisz(ctx, async () => {
      const n = await ctx.db.wstaw('client_notes', {
        client_id: klient.id, kind: 'sms', body: `Przypomnienie o płatności (${formatZl(d.kwotaGr)}): ${String(w.tresc ?? '').slice(0, 900)}`,
      });
      ctx.scal({ client_notes: [n] });
      ctx.toast('Zapisano przypomnienie w historii kontaktu');
      ctx.nawiguj(`klienci/${encodeURIComponent(klient.id)}`);
    });
  },
};

