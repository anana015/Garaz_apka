// Logowanie (rozdz. 11): e-mail i hasło albo link logowania wysłany e-mailem.
// Jeden użytkownik – konto zakłada się w panelu Supabase, aplikacja nie ma rejestracji.

import { esc, walidujEmail } from '../utils.js';

/** Stan formularza trzymany w state.ui, bo render() podmienia cały ekran. */
function stanFormularza(s) {
  s.ui.logowanie ??= { email: '', bledy: {}, blad: null, info: null, trwa: false };
  return s.ui.logowanie;
}

/** Pole z etykietą i błędem pod spodem, powiązanym przez aria-describedby (12.5). */
function pole({ id, nazwa, etykieta, typ, autocomplete, wartosc = '', blad, extra = '' }) {
  return `<div class="pole">
    <label for="${id}">${etykieta}</label>
    <input id="${id}" name="${nazwa}" type="${typ}" autocomplete="${autocomplete}" value="${esc(wartosc)}" ${extra}
      ${blad ? `aria-invalid="true" aria-describedby="${id}-blad"` : ''}>
    ${blad ? `<p id="${id}-blad" class="blad">${esc(blad)}</p>` : ''}
  </div>`;
}

export default {
  tytul: () => 'Logowanie',

  render(s) {
    const f = stanFormularza(s);
    const blad = f.blad ?? s.blad;   // błąd serwera albo błąd startu aplikacji
    return `
      <div class="logowanie">
        <section class="karta" aria-labelledby="log-tytul">
          <div class="logo">
            <img src="icons/icon.svg" alt="" width="44" height="44">
            <h1 id="log-tytul">Najem magazynów</h1>
          </div>
          <form data-formularz="logowanie" novalidate>
            ${pole({ id: 'log-email', nazwa: 'email', etykieta: 'E-mail', typ: 'email', autocomplete: 'username',
              wartosc: f.email, blad: f.bledy.email, extra: 'inputmode="email" required' })}
            ${pole({ id: 'log-haslo', nazwa: 'haslo', etykieta: 'Hasło', typ: 'password',
              autocomplete: 'current-password', blad: f.bledy.haslo })}
            ${blad ? `<p class="blad-tekst" role="alert">${esc(blad)}</p>` : ''}
            ${f.info ? `<p class="baner" role="status">${esc(f.info)}</p>` : ''}
            <button class="przycisk pelny" type="submit" name="tryb" value="haslo" ${f.trwa ? 'disabled' : ''}>
              ${f.trwa ? 'Logowanie…' : 'Zaloguj'}</button>
            <p class="lub">albo</p>
            <button class="przycisk drugi pelny" type="submit" name="tryb" value="link" ${f.trwa ? 'disabled' : ''}>
              Wyślij link logowania</button>
          </form>
        </section>
      </div>`;
  },

  formularze: {
    async logowanie(form, ctx, ev) {
      const f = stanFormularza(ctx.state);
      const tryb = ev.submitter?.value ?? 'haslo';
      const email = form.email.value.trim();
      const haslo = form.haslo.value;
      Object.assign(f, { email, bledy: {}, blad: null, info: null });
      ctx.state.blad = null;

      if (!walidujEmail(email)) f.bledy.email = 'Wpisz poprawny adres e-mail.';
      if (tryb === 'haslo' && !haslo) f.bledy.haslo = 'Wpisz hasło albo wybierz link logowania.';
      const pierwszyBlad = Object.keys(f.bledy)[0];
      if (pierwszyBlad) {
        ctx.render();
        // Hasło nie trafia do stanu ani do HTML, więc po przerysowaniu wpisujemy je z powrotem w pole.
        const pole = document.getElementById('log-haslo');
        if (pole) pole.value = haslo;
        document.getElementById(`log-${pierwszyBlad}`)?.focus();   // czytnik odczyta pole z błędem
        return;
      }

      f.trwa = true;
      ctx.render();
      try {
        if (tryb === 'link') {
          await ctx.db.wyslijLink(email);
          f.info = `Wysłano link logowania na ${email}. Otwórz go na tym urządzeniu.`;
        } else {
          await ctx.db.zaloguj(email, haslo);   // dalej prowadzi app.js (zmiana sesji)
        }
      } catch (e) {
        f.blad = e.message;
      } finally {
        f.trwa = false;
        if (ctx.state.faza === 'logowanie') ctx.render();
      }
    },
  },
};
