-- 007_news_groups_name_ci.sql
-- O unique do 005 compara bytes: "Eleicoes" e "eleicoes" viravam dois grupos
-- distintos na API, mas o leitor enxerga o mesmo nome. Este indice torna a
-- unicidade case-insensitive no banco, que e onde a garantia final mora (o
-- service tambem normaliza antes de escrever, mas so o indice impede corrida).

-- Espacos nas pontas contam como o mesmo nome.
update news_groups set name = trim(name) where name <> trim(name);

-- Merge defensivo de duplicatas existentes: guarda o mais antigo, move os
-- vinculos para ele e apaga os repetidos. Sem isso o create unique index
-- falharia em banco ja populado.
create temporary table _group_dups on commit drop as
  select array_agg(id order by created_at) as ids
    from news_groups
   group by lower(name)
  having count(*) > 1;

insert into saved_articles (group_id, article_id)
  select d.ids[1], sa.article_id
    from _group_dups d
    join saved_articles sa on sa.group_id = any(d.ids[2:array_length(d.ids, 1)])
  on conflict do nothing;

delete from saved_articles sa
 using _group_dups d
 where sa.group_id = any(d.ids[2:array_length(d.ids, 1)]);

delete from news_groups g
 using _group_dups d
 where g.id = any(d.ids[2:array_length(d.ids, 1)]);

drop table _group_dups;

create unique index if not exists news_groups_name_ci_idx
  on news_groups (lower(name));
