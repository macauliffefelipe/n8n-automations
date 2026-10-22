-- Sentinela Antipirataria · esquema Postgres
-- Se carga solo la primera vez que arranca el contenedor postgres (docker-entrypoint-initdb.d).
-- A mano: docker compose exec -T postgres psql -U sentinela -d sentinela < sql/schema.sql

CREATE TYPE achado_status AS ENUM
  ('novo','revisao','confirmado','rejeitado','notificado','removido','persistente');

CREATE TYPE canal_notif AS ENUM
  ('google_search','host_abuse','telegram','scribd','mercado_livre','amazon','meta','cloudflare');

-- ---------------------------------------------------------------- config
-- Interruptores y datos del agente. Se leen desde n8n con SELECT, no hay secretos acá.
CREATE TABLE config (
  chave text PRIMARY KEY,
  valor text NOT NULL,
  nota  text
);

INSERT INTO config (chave, valor, nota) VALUES
  ('dry_run',               'true',  'true = ninguna notificación sale (se arman y quedan aprobadas) y el reporte semanal va a agente_email, no a la autora. Pasalo a false recién con el documento de autorización firmado.'),
  ('auto_email',            'false', 'false = cada email espera tu botón Enviar en Telegram. true = sale solo (no lo actives en el piloto).'),
  ('umbral_auto',           '1.01',  'Confianza del LLM desde la cual un hallazgo pasa a confirmado sin humano. 1.01 = nunca, todo va a la cola. Spec original: 0.85.'),
  ('umbral_rechazo',        '1.01',  'Confianza desde la cual el LLM descarta solo un "no infractor". 1.01 = nunca, todo va a tu cola. Un descarte es definitivo. Bajalo a 0.8 cuando confíes en el triage.'),
  ('telegram_admin_chat_id','',      'Tu chat id de Telegram (hablale a @userinfobot). Solo este id puede apretar botones.'),
  ('agente_nome',           '',      'Nombre que firma las notificaciones (vos o FMA Solutions).'),
  ('agente_email',          '',      'Email desde el que salen las notificaciones y donde recibís respuestas.'),
  ('agente_endereco',       '',      'Dirección postal del agente (las notificaciones formales la piden).'),
  ('telegram_terminos',     'livros pdf,dark romance pdf,acervo literário,livros grátis,baixar livros epub', 'Términos para descubrir canales nuevos cada semana (separados por coma).');

-- ---------------------------------------------------------------- negocio
CREATE TABLE clientes (
  id                  serial PRIMARY KEY,
  nome                text NOT NULL,
  email               text NOT NULL,
  whatsapp            text,
  nome_autoral        text NOT NULL,
  cpf                 text,           -- LGPD: acceso restringido a esta base
  endereco            text,
  doc_autorizacao_url text,
  assinado_em         timestamptz,    -- NULL = sin autorización: no se notifica nada
  status              text NOT NULL DEFAULT 'ativo'
);

CREATE TABLE obras (
  id                serial PRIMARY KEY,
  cliente_id        int NOT NULL REFERENCES clientes(id),
  titulo            text NOT NULL,
  subtitulo         text,
  serie             text,
  isbn              text,
  asin              text,
  ano               int,
  capa_url          text,
  capa_phash        text,
  site_oficial      text,                      -- dominio, ej: autora.com.br
  frases_impressao  text[] NOT NULL DEFAULT '{}',  -- 3-5 frases raras del interior, 8-12 palabras
  titulos_variantes text[] NOT NULL DEFAULT '{}',
  urls_oficiais     text[] NOT NULL DEFAULT '{}',  -- whitelist: URLs exactas o prefijos oficiales
  ativa             boolean NOT NULL DEFAULT true
);

-- Plantillas de búsqueda. {t}=título {a}=nome_autoral {f}=frase {site_oficial}
-- motor: serp (DataForSEO) | telegram (servicio sentinela) | mercadolivre
CREATE TABLE plantillas (
  id        serial PRIMARY KEY,
  template  text NOT NULL,
  motor     text NOT NULL CHECK (motor IN ('serp','telegram','mercadolivre')),
  por_frase boolean NOT NULL DEFAULT false,   -- true = se expande una vez por cada frase_impressao
  activa    boolean NOT NULL DEFAULT true,
  UNIQUE (motor, template)
);

INSERT INTO plantillas (template, motor, por_frase) VALUES
  ('"{t}" "{a}" pdf',                                                     'serp', false),
  ('"{t}" "{a}" epub baixar',                                             'serp', false),
  ('"{t}" download gratis livro',                                         'serp', false),
  ('"{t}" pdf -site:amazon.com.br -site:{site_oficial}',                  'serp', false),
  ('site:t.me "{t}"',                                                     'serp', false),
  ('site:scribd.com OR site:docero.com.br OR site:passeidireto.com "{t}"','serp', false),
  ('site:4shared.com OR site:mediafire.com "{t}"',                        'serp', false),
  ('"{f}"',                                                               'serp', true),
  ('"{t}" "{a}" site:mercadolivre.com.br',                                'serp', false),
  ('"{t}" "{a}" site:amazon.com.br -site:{site_oficial}',                 'serp', false),
  ('{t} {a}',                                                             'telegram', false),
  ('{t} pdf',                                                             'telegram', false),
  ('{f}',                                                                 'telegram', true),
  ('{t} {a}',                                                             'mercadolivre', false);

CREATE TABLE buscas (
  id               serial PRIMARY KEY,
  obra_id          int NOT NULL REFERENCES obras(id),
  plantilla_id     int REFERENCES plantillas(id),
  template         text NOT NULL,          -- la query ya expandida
  motor            text NOT NULL,
  es_frase         boolean NOT NULL DEFAULT false,
  ultima_execucao  timestamptz,
  ativa            boolean NOT NULL DEFAULT true,
  UNIQUE (obra_id, motor, template)
);

-- Expande plantillas x obras. Idempotente. Devuelve cuántas buscas nuevas creó.
CREATE OR REPLACE FUNCTION generar_buscas() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH base AS (
    SELECT o.id AS obra_id,
           replace(o.titulo, '"', '')            AS t,
           replace(c.nome_autoral, '"', '')      AS a,
           o.site_oficial,
           o.frases_impressao,
           p.id AS plantilla_id, p.template, p.motor, p.por_frase
    FROM obras o
    JOIN clientes c ON c.id = o.cliente_id AND c.status = 'ativo'
    CROSS JOIN plantillas p
    WHERE o.ativa AND p.activa
      AND (p.template NOT LIKE '%{site_oficial}%' OR o.site_oficial IS NOT NULL)
  ),
  expandidas AS (
    SELECT obra_id, plantilla_id, motor, false AS es_frase,
           replace(replace(replace(template, '{t}', t), '{a}', a), '{site_oficial}', coalesce(site_oficial, '')) AS q
    FROM base WHERE NOT por_frase
    UNION
    SELECT b.obra_id, b.plantilla_id, b.motor, true,
           replace(b.template, '{f}', replace(f.frase, '"', ''))
    FROM base b
    CROSS JOIN LATERAL unnest(b.frases_impressao) AS f(frase)
    WHERE b.por_frase AND length(trim(f.frase)) > 0
  ),
  ins AS (
    INSERT INTO buscas (obra_id, plantilla_id, template, motor, es_frase)
    SELECT obra_id, plantilla_id, q, motor, es_frase FROM expandidas
    ON CONFLICT (obra_id, motor, template) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- hallazgos
-- Desvío respecto del spec: la unicidad es (obra_id, url_hash) y no url_hash solo.
-- Una misma página pirata puede tener dos libros de la misma autora y la notificación
-- tiene que nombrar ambas obras. La URL no se re-notifica nunca para la misma obra.
CREATE TABLE achados (
  id                    serial PRIMARY KEY,
  obra_id               int NOT NULL REFERENCES obras(id),
  busca_id              int REFERENCES buscas(id),
  url                   text NOT NULL,
  url_hash              text NOT NULL,
  plataforma            text NOT NULL DEFAULT 'web',
  motor                 text,
  snippet               text,
  es_frase              boolean NOT NULL DEFAULT false,
  achado_em             timestamptz NOT NULL DEFAULT now(),
  ultimo_visto          timestamptz NOT NULL DEFAULT now(),
  confianca             numeric,
  tipo                  text,
  motivo                text,
  status                achado_status NOT NULL DEFAULT 'novo',
  print_url             text,
  notas                 text,
  bot_msg_enviado       boolean NOT NULL DEFAULT false,
  aprobado_em           timestamptz,
  notificado_em         timestamptz,
  ultima_notificacao_em timestamptz,
  nivel_escalado        int NOT NULL DEFAULT 0,
  removido_em           timestamptz,
  dias_ate_remocao      int,
  UNIQUE (obra_id, url_hash)
);
CREATE INDEX achados_status_idx ON achados (status);

CREATE TABLE dominios (
  dominio               text PRIMARY KEY,
  ip                    text,
  host_nome             text,
  abuse_host_email      text,
  registrar             text,
  abuse_registrar_email text,
  cloudflare            boolean NOT NULL DEFAULT false,
  consultado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notificacoes (
  id               serial PRIMARY KEY,
  cliente_id       int NOT NULL REFERENCES clientes(id),
  canal            canal_notif NOT NULL,
  nivel            int NOT NULL DEFAULT 0,
  achado_ids       int[] NOT NULL,
  destinatario     text,
  asunto           text,
  corpo            text NOT NULL,
  status           text NOT NULL DEFAULT 'pendente_aprobacion'
    CHECK (status IN ('pendente_aprobacion','aprobada','enviada','pendente_manual',
                      'enviada_manual','fallida','cancelada')),
  ref_externa      text,
  creado_em        timestamptz NOT NULL DEFAULT now(),
  enviado_em       timestamptz,
  respondido_em    timestamptz,
  bot_msg_enviado  boolean NOT NULL DEFAULT false
);

CREATE TABLE verificacoes (
  id          serial PRIMARY KEY,
  achado_id   int NOT NULL REFERENCES achados(id),
  checado_em  timestamptz NOT NULL DEFAULT now(),
  http_status int,
  ainda_no_ar boolean,          -- NULL = chequeo inconcluso (timeout, DNS)
  nota        text
);
CREATE INDEX verificacoes_achado_idx ON verificacoes (achado_id, checado_em DESC);

-- ---------------------------------------------------------------- Telegram
CREATE TABLE grupos_telegram (        -- export semanal de las membresías de la cuenta sentinela
  chat_id      bigint PRIMARY KEY,
  titulo       text,
  username     text,
  tipo         text,
  miembros     int,
  exportado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grupos_candidatos (      -- cola de descubrimiento: vos aprobás antes de unirte
  id             serial PRIMARY KEY,
  username       text UNIQUE,
  titulo         text,
  tipo           text,
  miembros       int,
  termino        text,
  descubierto_em timestamptz NOT NULL DEFAULT now(),
  estado         text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo','aprobado','descartado','unido'))
);

CREATE TABLE canales_publicos (       -- canales con vista previa pública (t.me/s/<canal>), sin cuenta
  username text PRIMARY KEY,
  activo   boolean NOT NULL DEFAULT true,
  nota     text
);

CREATE TABLE alertas_rss (            -- feeds de Google Alerts (uno por obra)
  id      serial PRIMARY KEY,
  obra_id int NOT NULL REFERENCES obras(id),
  url     text NOT NULL UNIQUE,
  activa  boolean NOT NULL DEFAULT true
);

CREATE TABLE whitelist_dominios (     -- dominios que nunca son infracción por sí solos
  dominio text PRIMARY KEY,
  nota    text
);
INSERT INTO whitelist_dominios (dominio, nota) VALUES
  ('skoob.com.br','red social de lectores'),
  ('goodreads.com','red social de lectores'),
  ('hotmart.com','plataforma de venta oficial'),
  ('kiwify.com.br','plataforma de venta oficial'),
  ('wikipedia.org','enciclopedia'),
  ('books.google.com','vista previa legítima de Google Books'),
  ('youtube.com','reseñas y booktubers (revisar a mano si hace falta)');

CREATE TABLE reportes (
  id          serial PRIMARY KEY,
  cliente_id  int NOT NULL REFERENCES clientes(id),
  enviado_em  timestamptz NOT NULL DEFAULT now(),
  resumen     text
);
