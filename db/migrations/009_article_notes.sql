-- Anotacao pessoal do leitor sobre a noticia (uma por noticia, nao por colecao).
--
-- Vive em articles, nao em saved_articles, por dois motivos: a anotacao e sobre
-- a noticia (a mesma noticia em duas colecoes tem uma nota so), e ela precisa
-- sobreviver a desfazer o salvamento (saved_articles tem ON DELETE CASCADE).
alter table articles
  add column if not exists note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'articles_note_len_check'
       and conrelid = 'articles'::regclass
  ) then
    alter table articles add constraint articles_note_len_check
      check (note is null or char_length(note) <= 2000);
  end if;
end $$;

comment on column articles.note is 'anotacao pessoal do leitor sobre a noticia (2000 chars)';
