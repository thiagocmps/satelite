-- 002_seed.sql
-- Categorias, regras de categorizacao e fontes iniciais (todas RSS 2.0/Atom,
-- sem chave de API). Todos os URLs abaixo respondem 200 em 2026-09.

insert into categories (slug, name, description, color) values
  ('geral',      'Geral',      'Noticias sem categoria especifica',            '#64748b'),
  ('tecnologia', 'Tecnologia', 'Software, hardware, IA e internet',             '#0ea5e9'),
  ('ciencia',    'Ciencia',    'Pesquisa, espaco e discoveries',               '#8b5cf6'),
  ('economia',   'Economia',   'Mercados, negocios e politica economica',      '#22c55e'),
  ('politica',   'Politica',   'Governo, legislacao e elections',              '#f59e0b'),
  ('mundo',      'Mundo',      'Relacoes internacionais e conflitos',         '#ef4444'),
  ('esportes',   'Esportes',   'Competicoes e atletas',                       '#10b981'),
  ('cultura',    'Cultura',    'Cinema, musica, literatura e arte',            '#ec4899')
on conflict (slug) do nothing;

insert into category_rules (category_id, keyword)
select c.id, k.keyword
from categories c
join (values
  ('tecnologia', 'inteligencia artificial'), ('tecnologia', 'software'), ('tecnologia', 'startup'),
  ('tecnologia', 'aplicativo'),              ('tecnologia', 'criptomoeda'), ('tecnologia', 'open source'),
  ('tecnologia', 'smartphone'),              ('tecnologia', 'programacao'), ('tecnologia', 'internet'),
  ('tecnologia', 'chip'),                    ('tecnologia', 'algoritmo'),   ('tecnologia', 'app'),
  ('ciencia', 'espaco'),     ('ciencia', 'astronomia'), ('ciencia', 'sonda'), ('ciencia', 'planeta'),
  ('ciencia', 'cientista'),  ('ciencia', 'nasa'),      ('ciencia', 'telescopio'),
  ('economia', 'inflacao'),  ('economia', 'bolsa'),    ('economia', 'dolar'),   ('economia', 'mercado'),
  ('economia', 'tarifa'),    ('economia', 'economia'), ('economia', 'imposto'),
  ('politica', 'governo'),   ('politica', 'congresso'), ('politica', 'presidente'),
  ('politica', 'eleicoes'),  ('politica', 'senado'),   ('politica', 'camara'),
  ('mundo', 'guerra'),       ('mundo', 'russia'),     ('mundo', 'ucrania'),   ('mundo', 'gaza'),
  ('mundo', 'eua'),          ('mundo', 'china'),      ('mundo', 'onu'),
  ('esportes', 'futebol'),   ('esportes', 'campeonato'), ('esportes', 'olimpiadas'), ('esportes', 'clube'),
  ('cultura', 'cinema'),     ('cultura', 'musica'),   ('cultura', 'livro'),     ('cultura', 'festival')
) as k(category_slug, keyword) on true
where c.slug = k.category_slug
on conflict do nothing;

insert into sources (slug, name, feed_url, site_url, default_category_id)
select v.slug, v.name, v.feed_url, v.site_url, c.id
from (values
  ('g1',              'G1 Globo',          'https://g1.globo.com/rss/g1/',                      'https://g1.globo.com',            'geral'),
  ('g1-tecnologia',   'G1 Tecnologia',     'https://g1.globo.com/rss/g1/tecnologia/',            'https://g1.globo.com/tecnologia', 'tecnologia'),
  ('bbc-news',        'BBC News',          'https://feeds.bbci.co.uk/news/rss.xml',              'https://www.bbc.com/news',        'geral'),
  ('bbc-portugues',   'BBC Portugues',     'https://feeds.bbci.co.uk/portuguese/rss.xml',         'https://www.bbc.com/portuguese',  'geral'),
  ('the-guardian',    'The Guardian',      'https://www.theguardian.com/uk/rss',                 'https://www.theguardian.com',    'mundo'),
  ('techcrunch',      'TechCrunch',        'https://techcrunch.com/feed/',                       'https://techcrunch.com',         'tecnologia'),
  ('ars-technica',    'Ars Technica',      'https://feeds.arstechnica.com/arstechnica/index',    'https://arstechnica.com',        'tecnologia'),
  ('nasa',            'NASA',              'https://www.nasa.gov/feed/',                        'https://www.nasa.gov',           'ciencia'),
  ('nyt-tecnologia',  'NYT Tecnologia',    'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', 'https://www.nytimes.com', 'tecnologia')
) as v(slug, name, feed_url, site_url, category_slug)
left join categories c on c.slug = v.category_slug
on conflict (slug) do nothing;
