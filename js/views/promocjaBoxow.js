// Jednorazowo (0.26.0): „Promocja startowa −50% / 2 mies.” dla wszystkich najmów boxów – podgląd i zapis.
// Adres: #/promocja-boxow (Ustawienia → Promocje). Plan: promocje.js → planPromocjiBoxow.
// Zaznaczone domyślnie: najmy bez promocji; „uwaga” (dziś płaci stawkę promocyjną po końcu promocji) – do decyzji.

import { TYPY_JEDNOSTEK } from '../config.js';
import { formularz, stanFormularza, zapisz } from '../formularz.js';
import { DOMYSLNE_PROMOCJE, jestMigracja013, planPromocjiBoxow, wymagajaMigracji013 } from '../promocje.js';
import { pustyStan } from '../ui.js';
import { dodajDni, dzisiaj, esc, formatData, formatZl, odmiana } from '../utils.js';
import { ustawienia } from './wspolne.js';

const STATUS = {
  nowa: { tekst: 'do zapisu', klasa: 'czesciowo' },
  uwaga: { tekst: 'sprawdź', klasa: 'zalega' },
  'ma-promocje': { tekst: 'ma już promocję', klasa: 'ok' },
  brak: { tekst: 'pominięty', klasa: 'wylaczona' },
};

function opisPlanu(x) {
  const p = x.plan;
  const czesci = [];
  if (p.gratisDo) czesci.push(`gratis do ${formatData(p.gratisDo)}`);
  if (p.promocjaOd) czesci.push(`${formatZl(p.promocyjnaGr)} od ${formatData(p.promocjaOd)}${p.koniec ? ` do ${formatData(dodajDni(p.koniec, -1))}` : ''}`);
  czesci.push(p.koniec ? `potem ${formatZl(x.normalnaGr)} od ${formatData(p.koniec)}` : 'najem skończył się w trakcie promocji');
  return czesci.join(', ');
}

const plany = (s) => planPromocjiBoxow(s.dane, s.indeksy, { dzis: dzisiaj() });

function wiersz(x, zaznaczone) {
  const st = STATUS[x.status];
  const mozna = x.status === 'nowa' || x.status === 'uwaga';
  const id = esc(x.najem.id);
  const nazwa = `${x.jednostka.code} · ${x.klient?.name ?? '—'}`;
  return `<tr>
    <td>${mozna ? `<input type="checkbox" name="najem" value="${id}" id="pb-${id}"${zaznaczone.has(x.najem.id) ? ' checked' : ''}
      aria-label="Zapisz promocję: ${esc(nazwa)}">` : ''}</td>
    <td><label for="pb-${id}"><strong class="mono">${esc(x.jednostka.code)}</strong><br>
      <span class="maly">${esc(TYPY_JEDNOSTEK[x.jednostka.type]?.nazwa ?? x.jednostka.type)}</span></label></td>
    <td>${esc(x.klient?.name ?? '—')}<br><span class="maly wyciszony">${formatData(x.najem.start_on)}${
  x.najem.end_on ? ` – ${formatData(x.najem.end_on)}` : ''}</span></td>
    <td>${x.plan ? esc(opisPlanu(x)) : ''}${x.opis ? `<br><span class="maly">${esc(x.opis)}</span>` : ''}</td>
    <td><span class="status ${st.klasa}">${st.tekst}</span></td></tr>`;
}

export default {
  zakladka: 'raporty',
  tytul: () => 'Promocja startowa – wszystkie boxy',
  wstecz: () => ({ href: '#/ustawienia', tekst: 'Ustawienia' }),

  render(s) {
    const lista = plany(s);
    if (!lista.length) return pustyStan('Nie ma najmów boxów.', [{ tekst: 'Ustawienia', href: '#/ustawienia' }]);
    const f = stanFormularza(s, 'promocja-boxow', () => ({
      najem: lista.filter((x) => x.status === 'nowa').map((x) => x.najem.id),
    }));
    const zaznaczone = new Set([].concat(f.wartosci.najem ?? []));
    const ile = (st) => lista.filter((x) => x.status === st).length;
    const rozliczone = ustawienia(s).settled_through;
    return `<p><strong>${odmiana(lista.length, ['najem boxu', 'najmy boxów', 'najmów boxów'])}</strong>:
        do zapisu ${ile('nowa')}, do sprawdzenia ${ile('uwaga')}, z promocją ${ile('ma-promocje')}.</p>
      <p class="podpowiedz">„${esc(DOMYSLNE_PROMOCJE[0].nazwa)}” od dnia startu każdego najmu, według tej samej reguły co formularz
        „Promocja” (start 1.–10., 11.–22., od 23.). Zapisuje się jako stawki w historii najmu, widać ją w „Promocje i podwyżki”.
        ${rozliczone ? `Miesiące do ${formatData(rozliczone)} są uznane za rozliczone, więc dla starszych najmów zmienia się tylko historia;
        kwoty zmieniają się dla najmów, których promocja trwa po tej dacie.` : ''}
        Przed zapisem warto zrobić kopię (Ustawienia → Dane → Zapisz kopię).</p>
      ${formularz(f, {
    nazwa: 'promocja-boxow', przycisk: `Zapisz promocję dla zaznaczonych (${zaznaczone.size})`, anuluj: '#/ustawienia', uwaga: '',
    tresc: `<div class="tabela-przewijana"><table class="tabela">
        <thead><tr><th scope="col"><span class="sr-only">Zapisz</span></th><th scope="col">Box</th><th scope="col">Klient, najem</th>
          <th scope="col">Promocja po zapisie</th><th scope="col">Stan</th></tr></thead>
        <tbody>${lista.map((x) => wiersz(x, zaznaczone)).join('')}</tbody></table></div>`,
  })}`;
  },

  /** Licznik na przycisku nadąża za zaznaczeniem. */
  poRenderze(root, s) {
    const form = root.querySelector('form[data-formularz="promocja-boxow"]');
    form?.addEventListener('change', () => {
      const wybrane = [...form.querySelectorAll('input[name="najem"]:checked')].map((i) => i.value);
      if (s.ui.form) s.ui.form.wartosci.najem = wybrane;
      const btn = form.querySelector('button[type="submit"]');
      if (btn && !s.ui.form?.trwa) btn.textContent = `Zapisz promocję dla zaznaczonych (${wybrane.length})`;
    });
  },

  formularze: {
    async 'promocja-boxow'(form, ctx) {
      const s = ctx.state;
      const wybrane = new Set([...form.querySelectorAll('input[name="najem"]:checked')].map((i) => i.value));
      s.ui.form.wartosci.najem = [...wybrane];
      const doZapisu = plany(s).filter((x) => wybrane.has(x.najem.id) && x.wiersze);
      if (!doZapisu.length) { ctx.toast('Nic nie zaznaczono.'); return; }
      if (doZapisu.some((x) => wymagajaMigracji013(x.wiersze)) && !jestMigracja013(s.dane.rental_rates)) {
        s.ui.form.blad = 'Część promocji wymaga zmiany w bazie: uruchom supabase/migracje/013_promocje_od_dnia.sql.';
        ctx.render();
        return;
      }
      await zapisz(ctx, async () => {
        let zapisane = [];
        const usuniete = new Set();
        let gotowe = 0;
        try {
          for (const x of doZapisu) {
            for (const st of x.doUsuniecia) {
              await ctx.db.usun('rental_rates', st.id);
              usuniete.add(st.id);
            }
            zapisane = zapisane.concat(await ctx.db.zapiszWiele('rental_rates', x.wiersze, 'rental_id,valid_from'));
            gotowe += 1;
          }
        } finally {
          // Część mogła się zapisać przed błędem – stan lokalny zgodny z bazą.
          s.dane = { ...s.dane, rental_rates: s.dane.rental_rates.filter((st) => !usuniete.has(st.id)) };
          ctx.scal({ rental_rates: zapisane });
          if (gotowe < doZapisu.length) ctx.toast(`Zapisano ${gotowe} z ${doZapisu.length} – reszta nie (spróbuj jeszcze raz).`);
        }
        ctx.toast(`Zapisano promocję dla ${odmiana(gotowe, ['najmu', 'najmów', 'najmów'])}`);
        ctx.nawiguj('stawki');
      });
    },
  },
};
