-- 002: miejsce płatności przy najmie (decyzja 4, 10.11.2026).
-- Każdy najem ma zapisane, gdzie klient płaci: przelew na konkretne konto, gotówka albo FV
-- (FV – oznaczane ręcznie). Uruchomić w Supabase → SQL Editor po 001. Można uruchomić ponownie bez szkody.

alter table rentals add column if not exists pay_method text not null default 'przelew';
alter table rentals add column if not exists bank_account_id uuid references bank_accounts on delete restrict;

alter table rentals drop constraint if exists rentals_pay_method_check;
alter table rentals add constraint rentals_pay_method_check
  check (pay_method in ('przelew', 'gotowka', 'fv'));

-- Gotówka nie ma konta. Przelew może jeszcze nie mieć wskazanego konta (puste = nieustalone).
alter table rentals drop constraint if exists rentals_gotowka_bez_konta;
alter table rentals add constraint rentals_gotowka_bez_konta
  check (pay_method <> 'gotowka' or bank_account_id is null);

create index if not exists rentals_bank_account on rentals (bank_account_id) where bank_account_id is not null;

comment on column rentals.pay_method is 'Gdzie klient płaci za ten najem: przelew (konto w bank_account_id), gotowka, fv';
comment on column rentals.bank_account_id is 'Konto, na które wpływa czynsz za ten najem (tylko przy przelewie)';

-- Bank Millennium na liście banków (bank_accounts.bank). Jeśli w schemacie jest ograniczenie listy banków,
-- dopisujemy do niego millennium; jeśli go nie ma – nic się nie zmienia.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'bank_accounts_bank_check') then
    alter table bank_accounts drop constraint bank_accounts_bank_check;
    alter table bank_accounts add constraint bank_accounts_bank_check
      check (bank in ('nest', 'pekao', 'pko', 'alior', 'millennium', 'inny'));
  end if;
end $$;
