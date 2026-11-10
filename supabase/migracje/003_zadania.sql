-- 003: notatki z terminem jako zadania (zakładka „Zadania”).
-- promised_on = termin zadania (przy obietnicy: „zapłaci do”); dowolny rodzaj notatki może mieć termin.
-- Bezpieczne do ponownego uruchomienia.

alter table public.client_notes
  add column if not exists task_owner text,
  add column if not exists done_at timestamptz;

do $$ begin
  alter table public.client_notes
    add constraint client_notes_task_owner_chk check (task_owner in ('ja', 'klient'));
exception when duplicate_object then null; end $$;

-- Istniejące obietnice: zadanie klienta.
update public.client_notes set task_owner = 'klient'
where kind = 'obietnica' and promised_on is not null and task_owner is null;

create index if not exists client_notes_zadania
  on public.client_notes (user_id, promised_on) where promised_on is not null and done_at is null;

comment on column public.client_notes.promised_on is 'Termin zadania; przy obietnicy – data, do której klient obiecał zapłacić';
comment on column public.client_notes.task_owner is 'Czyje zadanie: ja (wynajmujący) albo klient';
comment on column public.client_notes.done_at is 'Kiedy zadanie oznaczono jako zrobione (null = do zrobienia)';
