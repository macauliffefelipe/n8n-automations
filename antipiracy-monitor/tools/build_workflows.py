#!/usr/bin/env python3
"""Genera los workflows de n8n (JSON importable) a partir de tools/js/*.js y las consultas SQL de este archivo.

    python3 tools/build_workflows.py        ->  escribe workflows/*.json
"""
import json
import re
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "tools" / "js"
OUT = ROOT / "workflows"
OUT.mkdir(exist_ok=True)

# Edita estos hostnames si tu red de Docker usa otros
SENTINELA_URL = "http://sentinela:8088"
GOTENBERG_URL = "http://gotenberg:3000"
OLLAMA_URL = "http://host.docker.internal:11434/api/chat"   # n8n en Docker en la misma Mac que Ollama. Si Ollama está en otra máquina, cambiá el host (ver README)

CRED_PG = {"postgres": {"id": "SntPostgres_001", "name": "Sentinela Postgres"}}
CRED_TG = {"telegramApi": {"id": "SntTelegram_001", "name": "Sentinela Bot"}}
CRED_SMTP = {"smtp": {"id": "SntSmtp_001", "name": "SMTP Sentinela"}}
CRED_SVC = {"httpHeaderAuth": {"id": "SntApiKey_001", "name": "Sentinela API Key"}}
CRED_SERP = {"httpBasicAuth": {"id": "SntDataForSEO_001", "name": "DataForSEO"}}


def js(name: str) -> str:
    """Lee un script y resuelve '// @include common.js'."""
    src = (JS / name).read_text(encoding="utf-8")
    def inc(m):
        return (JS / m.group(1)).read_text(encoding="utf-8")
    return re.sub(r"^// @include (\S+)\n", inc, src, flags=re.M).strip() + "\n"


class WF:
    def __init__(self, name: str):
        self.name = name
        self.nodes = []
        self.conns = {}
        self.names = set()

    def add(self, name, type_, ver, params=None, pos=(0, 0), creds=None, **extra):
        assert name not in self.names, f"nombre repetido: {name}"
        self.names.add(name)
        node = {"parameters": params or {}, "id": str(uuid.uuid4()), "name": name, "type": type_,
                "typeVersion": ver, "position": [pos[0] * 260, pos[1] * 170]}
        if creds:
            node["credentials"] = creds
        node.update(extra)
        self.nodes.append(node)
        return name

    def link(self, a, b, out=0, inp=0):
        assert a in self.names and b in self.names, (a, b)
        main = self.conns.setdefault(a, {"main": []})["main"]
        while len(main) <= out:
            main.append([])
        main[out].append({"node": b, "type": "main", "index": inp})

    def chain(self, *names):
        for a, b in zip(names, names[1:]):
            self.link(a, b)

    def save(self, fname):
        data = {"name": self.name, "nodes": self.nodes, "connections": self.conns, "active": False,
                "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}, "pinData": {}}
        (OUT / fname).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ----------------------------------------------------------------- piezas reutilizables
def cron(w, name, expr, pos):
    return w.add(name, "n8n-nodes-base.scheduleTrigger", 1.2,
                 {"rule": {"interval": [{"field": "cronExpression", "expression": expr}]}}, pos)


def every_minutes(w, name, minutes, pos):
    return w.add(name, "n8n-nodes-base.scheduleTrigger", 1.2,
                 {"rule": {"interval": [{"field": "minutes", "minutesInterval": minutes}]}}, pos)


def manual(w, name, pos):
    return w.add(name, "n8n-nodes-base.manualTrigger", 1, {}, pos)


def pg(w, name, query, pos, params=None, **extra):
    p = {"operation": "executeQuery", "query": query, "options": {}}
    if params:
        p["options"]["queryReplacement"] = "={{ " + params + " }}"
    return w.add(name, "n8n-nodes-base.postgres", 2.5, p, pos, CRED_PG, **extra)


def code(w, name, script, pos, **extra):
    return w.add(name, "n8n-nodes-base.code", 2, {"jsCode": js(script)}, pos, **extra)


def code_inline(w, name, script, pos, **extra):
    return w.add(name, "n8n-nodes-base.code", 2, {"jsCode": script}, pos, **extra)


def merge_pos(w, name, pos):
    return w.add(name, "n8n-nodes-base.merge", 3,
                 {"mode": "combine", "combineBy": "combineByPosition", "options": {}}, pos)


def if_bool(w, name, expr, pos):
    return w.add(name, "n8n-nodes-base.if", 2.2, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": str(uuid.uuid4()), "leftValue": "={{ " + expr + " }}", "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"},
        "options": {}}, pos)


def http_svc(w, name, path, body_expr, pos, timeout=60000, batch=None, method="POST", **extra):
    opts = {"timeout": timeout}
    if batch:
        opts["batching"] = {"batch": {"batchSize": batch[0], "batchInterval": batch[1]}}
    p = {"method": method, "url": SENTINELA_URL + path, "authentication": "genericCredentialType",
         "genericAuthType": "httpHeaderAuth", "options": opts}
    if body_expr:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": "={{ " + body_expr + " }}"})
    return w.add(name, "n8n-nodes-base.httpRequest", 4.2, p, pos, CRED_SVC, onError="continueRegularOutput", **extra)


def http_ollama(w, name, pos):
    return w.add(name, "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": OLLAMA_URL, "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.ollama_body) }}",
        "options": {"timeout": 240000, "batching": {"batch": {"batchSize": 1, "batchInterval": 0}}}},
        pos, onError="continueRegularOutput")


def tg_send(w, name, pos, chat="$json.chat_id", text="$json.texto", buttons=True):
    p = {"resource": "message", "operation": "sendMessage", "chatId": "={{ " + chat + " }}",
         "text": "={{ " + text + " }}",
         "additionalFields": {"parse_mode": "HTML", "appendAttribution": False, "disable_web_page_preview": True}}
    if buttons:
        p["replyMarkup"] = "inlineKeyboard"
        p["inlineKeyboard"] = {"rows": [{"row": {"buttons": [
            {"text": "={{ $json.b1_text }}", "additionalFields": {"callback_data": "={{ $json.b1_data }}"}},
            {"text": "={{ $json.b2_text }}", "additionalFields": {"callback_data": "={{ $json.b2_data }}"}}]}}]}
    return w.add(name, "n8n-nodes-base.telegram", 1.2, p, pos, CRED_TG)


CFG_SQL = "SELECT jsonb_object_agg(chave, valor) AS cfg FROM config;"


def alerta_detec(w, parser, sufijo, pos):
    """Avisa por Telegram si alguna consulta de la fuente falló (los HTTP siguen de largo y el 00 no se entera)."""
    a = code(w, "Errores " + sufijo, "det_alerta.js", pos)
    t = tg_send(w, "Avisar errores " + sufijo, (pos[0] + 1, pos[1]), buttons=False)
    w.link(parser, a); w.link(a, t)
ADMIN_SQL = "SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id';"

UPSERT_SQL = """WITH ejec AS (
  UPDATE buscas SET ultima_execucao = now()
  WHERE id IN (SELECT jsonb_array_elements_text($2::jsonb)::int)
  RETURNING id
), ins AS (
  INSERT INTO achados (obra_id, busca_id, url, url_hash, plataforma, motor, snippet, es_frase)
  SELECT DISTINCT ON (r.obra_id, md5(r.url))
         r.obra_id, r.busca_id, r.url, md5(r.url), r.plataforma, r.motor, left(r.snippet, 1000), coalesce(r.es_frase, false)
  FROM jsonb_to_recordset($1::jsonb) AS r(obra_id int, busca_id int, url text, plataforma text, motor text, snippet text, es_frase boolean)
  WHERE EXISTS (SELECT 1 FROM obras o WHERE o.id = r.obra_id)
  ORDER BY r.obra_id, md5(r.url), r.es_frase DESC
  ON CONFLICT (obra_id, url_hash) DO UPDATE SET ultimo_visto = now()
  RETURNING (xmax = 0) AS nuevo
)
SELECT count(*) FILTER (WHERE nuevo) AS nuevos, count(*) AS total, (SELECT count(*) FROM ejec) AS buscas_ejecutadas FROM ins;"""
UPSERT_PARAMS = "[JSON.stringify($json.rows || []), JSON.stringify($json.busca_ids || [])]"


# ================================================================= 00 · error
def wf_error():
    w = WF("Sentinela 00 · Alerta de errores")
    w.add("Error Trigger", "n8n-nodes-base.errorTrigger", 1, {}, (0, 0))
    pg(w, "Admin chat", ADMIN_SQL, (1, 0))
    code(w, "Armar aviso", "err_msg.js", (2, 0))
    tg_send(w, "Avisar por Telegram", (3, 0), buttons=False)
    w.chain("Error Trigger", "Admin chat", "Armar aviso", "Avisar por Telegram")
    w.save("00-alerta-errores.json")


# ================================================================= 01 · detección
def wf_deteccion():
    w = WF("Sentinela 01 · Deteccion")
    cron(w, "Cron 07:00", "0 7 * * *", (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "Config", CFG_SQL, (1, 0))
    pg(w, "Generar buscas", "SELECT generar_buscas() AS nuevas;", (2, 0))

    # --- Web (SERP)
    pg(w, "Buscas SERP",
       "SELECT b.id AS busca_id, b.obra_id, b.template AS q, b.es_frase FROM buscas b JOIN obras o ON o.id = b.obra_id "
       "WHERE b.ativa AND o.ativa AND b.motor = 'serp' ORDER BY b.id;", (3, 0))
    w.add("DataForSEO", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
        "authentication": "genericCredentialType", "genericAuthType": "httpBasicAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify([{ keyword: $json.q, location_code: 2076, language_code: 'pt', depth: 10, "
                    "tag: $json.busca_id + '|' + $json.obra_id + '|' + ($json.es_frase ? 1 : 0) }]) }}",
        "options": {"timeout": 60000, "batching": {"batch": {"batchSize": 5, "batchInterval": 1000}}}},
        (4, 0), CRED_SERP, onError="continueRegularOutput")
    code(w, "Parsear SERP", "serp_parse.js", (5, 0))
    pg(w, "Guardar SERP", UPSERT_SQL, (6, 0), UPSERT_PARAMS)

    # --- Google Alerts (RSS)
    pg(w, "Feeds RSS", "SELECT id, url, obra_id FROM alertas_rss WHERE activa;", (3, 1))
    w.add("Bajar feed", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "GET", "url": "={{ $json.url }}",
        "options": {"timeout": 30000, "response": {"response": {"responseFormat": "text", "neverError": True}}}},
        (4, 1), onError="continueRegularOutput")
    merge_pos(w, "Unir feed", (5, 1))
    code(w, "Parsear RSS", "rss_parse.js", (6, 1))
    pg(w, "Guardar RSS", UPSERT_SQL, (7, 1), UPSERT_PARAMS)

    # --- Telegram (cuenta sentinela)
    pg(w, "Buscas Telegram",
       "SELECT b.id AS busca_id, b.obra_id, b.template AS q, b.es_frase FROM buscas b JOIN obras o ON o.id = b.obra_id "
       "WHERE b.ativa AND o.ativa AND b.motor = 'telegram' ORDER BY b.id;", (3, 2))
    http_svc(w, "Sentinela buscar", "/buscar", "JSON.stringify({ query: $json.q, limit: 30 })", (4, 2),
             timeout=180000, batch=(1, 3000))
    merge_pos(w, "Unir Telegram", (5, 2))
    code(w, "Parsear Telegram", "tg_parse.js", (6, 2))
    pg(w, "Guardar Telegram", UPSERT_SQL, (7, 2), UPSERT_PARAMS)

    # --- Canales públicos t.me/s/<canal> (sin cuenta)
    pg(w, "Canales x obras",
       "SELECT c.username, o.id AS obra_id, o.titulo FROM canales_publicos c CROSS JOIN obras o "
       "WHERE c.activo AND o.ativa ORDER BY c.username, o.id;", (3, 3))
    w.add("Bajar canal publico", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "GET",
        "url": "={{ 'https://t.me/s/' + $json.username + '?q=' + encodeURIComponent($json.titulo) }}",
        "options": {"timeout": 30000, "batching": {"batch": {"batchSize": 1, "batchInterval": 3000}},
                    "response": {"response": {"responseFormat": "text", "neverError": True}}}},
        (4, 3), onError="continueRegularOutput")
    merge_pos(w, "Unir canal publico", (5, 3))
    code(w, "Parsear canal publico", "tgpub_parse.js", (6, 3))
    pg(w, "Guardar canal publico", UPSERT_SQL, (7, 3), UPSERT_PARAMS)

    for t in ("Cron 07:00", "Manual"):
        w.link(t, "Config")
    w.chain("Config", "Generar buscas")
    for head in ("Buscas SERP", "Feeds RSS", "Buscas Telegram", "Canales x obras"):
        w.link("Generar buscas", head)
    w.chain("Buscas SERP", "DataForSEO", "Parsear SERP", "Guardar SERP")
    w.link("Feeds RSS", "Bajar feed"); w.link("Feeds RSS", "Unir feed", 0, 0); w.link("Bajar feed", "Unir feed", 0, 1)
    w.chain("Unir feed", "Parsear RSS", "Guardar RSS")
    w.link("Buscas Telegram", "Sentinela buscar"); w.link("Buscas Telegram", "Unir Telegram", 0, 0)
    w.link("Sentinela buscar", "Unir Telegram", 0, 1)
    w.chain("Unir Telegram", "Parsear Telegram", "Guardar Telegram")
    w.link("Canales x obras", "Bajar canal publico"); w.link("Canales x obras", "Unir canal publico", 0, 0)
    w.link("Bajar canal publico", "Unir canal publico", 0, 1)
    w.chain("Unir canal publico", "Parsear canal publico", "Guardar canal publico")
    alerta_detec(w, "Parsear SERP", "SERP", (6, 4))
    alerta_detec(w, "Parsear RSS", "RSS", (6, 5))
    alerta_detec(w, "Parsear Telegram", "Telegram", (6, 6))
    alerta_detec(w, "Parsear canal publico", "canal publico", (6, 7))
    w.save("01-deteccion.json")


# ================================================================= 02 · triage
def wf_triage():
    w = WF("Sentinela 02 · Triage")
    every_minutes(w, "Cada 30 min", 30, (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "Config", CFG_SQL, (1, 0))
    pg(w, "Hallazgos nuevos", """SELECT a.id, a.url, a.plataforma, a.snippet, a.es_frase,
       o.titulo AS obra_titulo, o.asin, o.urls_oficiais, o.site_oficial, c.nome_autoral,
       (SELECT coalesce(array_agg(dominio), '{}') FROM whitelist_dominios) AS wl
FROM achados a
JOIN obras o ON o.id = a.obra_id
JOIN clientes c ON c.id = o.cliente_id
WHERE a.status = 'novo'
ORDER BY a.es_frase DESC, a.id
LIMIT 20;""", (2, 0))
    code(w, "Whitelist", "tri_whitelist.js", (3, 0))
    if_bool(w, "En whitelist?", "$json.en_whitelist", (4, 0))
    pg(w, "Rechazar whitelist",
       "UPDATE achados SET status = 'rejeitado', motivo = $2 WHERE id = $1::int AND status = 'novo' RETURNING id;",
       (5, 0), "[$json.id, $json.wl_motivo]")
    http_svc(w, "Bajar pagina", "/pagina", "JSON.stringify({ url: $json.url })", (5, 1), timeout=40000, batch=(1, 500))
    merge_pos(w, "Unir pagina", (6, 1))
    code(w, "Armar prompt", "tri_prompt.js", (7, 1))
    http_ollama(w, "Ollama", (8, 1))
    merge_pos(w, "Unir respuesta LLM", (9, 1))
    code(w, "Decidir", "tri_decide.js", (10, 1))
    pg(w, "Guardar triage",
       "UPDATE achados SET status = $2::achado_status, confianca = NULLIF($3, '')::numeric, tipo = $4, motivo = $5 "
       "WHERE id = $1::int AND status = 'novo' AND $2::text <> 'novo' RETURNING id, url, status;",
       (11, 1), "[$json.id, $json.status, $json.confianca == null ? '' : String($json.confianca), $json.tipo || '', $json.motivo || '']")
    w.add("Necesita captura?", "n8n-nodes-base.if", 2.2, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                       "conditions": [{"id": str(uuid.uuid4()), "leftValue": "={{ $json.status }}", "rightValue": "rejeitado",
                                       "operator": {"type": "string", "operation": "notEquals"}}],
                       "combinator": "and"}, "options": {}}, (12, 1))
    http_svc(w, "Captura", "/captura", "JSON.stringify({ achado_id: $json.id, url: $json.url })", (13, 1),
             timeout=90000, batch=(1, 500))
    merge_pos(w, "Unir captura", (14, 1))
    pg(w, "Guardar captura",
       "UPDATE achados SET print_url = NULLIF($2, '') WHERE id = $1::int AND $3::text = 'true' RETURNING id;",
       (15, 1), "[$json.id, $json.print_url || '', String($json.ok === true)]")

    for t in ("Cada 30 min", "Manual"):
        w.link(t, "Config")
    w.chain("Config", "Hallazgos nuevos", "Whitelist", "En whitelist?")
    w.link("En whitelist?", "Rechazar whitelist", 0)
    w.link("En whitelist?", "Bajar pagina", 1)
    w.link("En whitelist?", "Unir pagina", 1, 0)
    w.link("Bajar pagina", "Unir pagina", 0, 1)
    w.chain("Unir pagina", "Armar prompt")
    w.link("Armar prompt", "Ollama"); w.link("Armar prompt", "Unir respuesta LLM", 0, 0)
    w.link("Ollama", "Unir respuesta LLM", 0, 1)
    w.chain("Unir respuesta LLM", "Decidir", "Guardar triage", "Necesita captura?")
    w.link("Necesita captura?", "Captura", 0)
    w.link("Necesita captura?", "Unir captura", 0, 0)
    w.link("Captura", "Unir captura", 0, 1)
    w.chain("Unir captura", "Guardar captura")
    code(w, "Ollama caido?", "tri_alerta.js", (11, 2))
    tg_send(w, "Avisar Ollama", (12, 2), buttons=False)
    w.link("Decidir", "Ollama caido?"); w.link("Ollama caido?", "Avisar Ollama")
    w.save("02-triage.json")


# ================================================================= 03 · bot de aprobación
def wf_bot():
    w = WF("Sentinela 03 · Bot de aprobacion")
    # A) mensajes salientes
    every_minutes(w, "Cada 5 min", 5, (0, 0))
    manual(w, "Manual", (0, 1))
    pg(w, "Hallazgos en revision", """SELECT a.id, a.url, a.plataforma, a.confianca, a.tipo, a.motivo,
       left(a.snippet, 300) AS snippet, (a.print_url IS NOT NULL) AS con_captura,
       o.titulo AS obra, c.nome_autoral, (c.assinado_em IS NULL) AS sin_autorizacion,
       (SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id') AS chat_id
FROM achados a
JOIN obras o ON o.id = a.obra_id
JOIN clientes c ON c.id = o.cliente_id
WHERE a.status = 'revisao' AND NOT a.bot_msg_enviado
ORDER BY a.es_frase DESC, a.confianca DESC NULLS LAST, a.id
LIMIT 10;""", (1, 0))
    code(w, "Formatear hallazgos", "bot_fmt_achados.js", (2, 0))
    tg_send(w, "Enviar hallazgo", (3, 0))
    pg(w, "Marcar hallazgo enviado",
       "UPDATE achados SET bot_msg_enviado = true WHERE id = $1::int RETURNING id;", (4, 0),
       "[$('Formatear hallazgos').item.json.id]")

    pg(w, "Notificaciones pendientes", """SELECT n.id, n.canal, n.status, n.destinatario, n.asunto, n.corpo, n.nivel,
       array_length(n.achado_ids, 1) AS n_urls,
       (SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id') AS chat_id,
       (SELECT valor FROM config WHERE chave = 'dry_run') AS dry_run
FROM notificacoes n
WHERE NOT n.bot_msg_enviado AND n.status IN ('pendente_aprobacion', 'pendente_manual')
ORDER BY n.id
LIMIT 10;""", (1, 1))
    code(w, "Formatear notificaciones", "bot_fmt_notifs.js", (2, 1))
    tg_send(w, "Enviar notificacion", (3, 1))
    pg(w, "Marcar notificacion enviada",
       "UPDATE notificacoes SET bot_msg_enviado = true WHERE id = $1::int RETURNING id;", (4, 1),
       "[$('Formatear notificaciones').item.json.id]")

    for t in ("Cada 5 min", "Manual"):
        w.link(t, "Hallazgos en revision"); w.link(t, "Notificaciones pendientes")
    w.chain("Hallazgos en revision", "Formatear hallazgos", "Enviar hallazgo", "Marcar hallazgo enviado")
    w.chain("Notificaciones pendientes", "Formatear notificaciones", "Enviar notificacion", "Marcar notificacion enviada")

    # B) botones entrantes
    w.add("Telegram Trigger", "n8n-nodes-base.telegramTrigger", 1.1,
          {"updates": ["callback_query"], "additionalFields": {}}, (0, 3), CRED_TG)
    pg(w, "Admin id", ADMIN_SQL, (1, 3))
    code(w, "Parsear callback", "bot_callback.js", (2, 3))
    if_bool(w, "Autorizado?", "$json.ok", (3, 3))
    pg(w, "Aplicar accion", """WITH a AS (
  UPDATE achados SET status = CASE WHEN $1::text = 'ap' THEN 'confirmado'::achado_status ELSE 'rejeitado'::achado_status END,
         aprobado_em = now()
  WHERE $1::text IN ('ap', 're') AND id = $2::int AND status = 'revisao'
  RETURNING id
), n AS (
  UPDATE notificacoes
  SET status = CASE $1::text WHEN 'se' THEN 'aprobada' WHEN 'cn' THEN 'cancelada' ELSE 'enviada_manual' END,
      enviado_em = CASE WHEN $1::text = 'em' THEN now() ELSE enviado_em END
  WHERE $1::text IN ('se', 'cn', 'em') AND id = $2::int
    AND status IN ('pendente_aprobacion', 'pendente_manual')
    AND NOT ($1::text = 'se' AND status = 'pendente_manual')
    AND NOT ($1::text = 'em' AND status = 'pendente_aprobacion')
  RETURNING id, achado_ids
), marcar AS (
  UPDATE achados SET status = 'notificado', notificado_em = coalesce(notificado_em, now()), ultima_notificacao_em = now()
  WHERE $1::text = 'em' AND status IN ('confirmado', 'notificado') AND id IN (SELECT unnest(achado_ids) FROM n)
  RETURNING id
), cancelar AS (
  UPDATE achados x SET status = 'rejeitado', notas = coalesce(x.notas || ' | ', '') || 'notificacion cancelada'
  WHERE $1::text = 'cn' AND x.status = 'confirmado' AND x.id IN (SELECT unnest(achado_ids) FROM n)
    AND NOT EXISTS (SELECT 1 FROM notificacoes o WHERE o.id <> $2::int AND o.status <> 'cancelada'
                    AND x.id = ANY (o.achado_ids) AND o.nivel = x.nivel_escalado)
  RETURNING x.id
)
SELECT (SELECT count(*) FROM a) AS achados, (SELECT count(*) FROM n) AS notifs;""", (4, 3), "[$json.accion, $json.id]")
    code(w, "Armar resultado", "bot_resultado.js", (5, 3))
    w.add("No autorizado", "n8n-nodes-base.set", 3.4, {
        "assignments": {"assignments": [
            {"id": str(uuid.uuid4()), "name": "query_id", "value": "={{ $json.query_id }}", "type": "string"},
            {"id": str(uuid.uuid4()), "name": "answer_text", "value": "={{ $json.answer_text }}", "type": "string"}]},
        "options": {}}, (4, 4))
    w.add("Responder boton", "n8n-nodes-base.telegram", 1.2, {
        "resource": "callback", "operation": "answerQuery", "queryId": "={{ $json.query_id }}",
        "additionalFields": {"text": "={{ $json.answer_text }}"}}, (6, 3), CRED_TG)
    w.add("Editar mensaje", "n8n-nodes-base.telegram", 1.2, {
        "resource": "message", "operation": "editMessageText", "chatId": "={{ $json.chat_id }}",
        "messageId": "={{ $json.message_id }}", "text": "={{ $json.nuevo_texto }}",
        "additionalFields": {"appendAttribution": False}}, (6, 4), CRED_TG)

    w.chain("Telegram Trigger", "Admin id", "Parsear callback", "Autorizado?")
    w.link("Autorizado?", "Aplicar accion", 0)
    w.link("Autorizado?", "No autorizado", 1)
    w.chain("Aplicar accion", "Armar resultado")
    w.link("Armar resultado", "Responder boton"); w.link("Armar resultado", "Editar mensaje")
    w.link("No autorizado", "Responder boton")
    w.save("03-bot-aprobacion.json")


# ================================================================= 04 · notificaciones
def wf_notificaciones():
    w = WF("Sentinela 04 · Notificaciones")
    every_minutes(w, "Cada 10 min", 10, (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "Config", CFG_SQL, (1, 0))

    # --- a) lookup de dominios nuevos
    pg(w, "Dominios sin consultar", """SELECT DISTINCT d AS dominio FROM (
  SELECT lower(substring(a.url FROM '^https?://(?:www\\.)?([^/:?#]+)')) AS d
  FROM achados a
  WHERE a.status = 'confirmado' AND a.plataforma NOT IN ('telegram', 'mercadolivre', 'amazon')
) x
WHERE d IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dominios dm WHERE dm.dominio = x.d AND dm.consultado_em > now() - interval '30 days')
LIMIT 20;""", (2, 0), alwaysOutputData=True)
    code(w, "Consultar DNS y RDAP", "ntf_dominio.js", (3, 0))
    pg(w, "Guardar dominios", """INSERT INTO dominios (dominio, ip, host_nome, abuse_host_email, registrar, abuse_registrar_email, cloudflare)
SELECT r.dominio, r.ip, r.host_nome, r.abuse_host_email, r.registrar, r.abuse_registrar_email, coalesce(r.cloudflare, false)
FROM jsonb_to_recordset($1::jsonb) AS r(dominio text, ip text, host_nome text, abuse_host_email text, registrar text, abuse_registrar_email text, cloudflare boolean)
ON CONFLICT (dominio) DO UPDATE SET ip = EXCLUDED.ip, host_nome = EXCLUDED.host_nome,
  abuse_host_email = EXCLUDED.abuse_host_email, registrar = EXCLUDED.registrar,
  abuse_registrar_email = EXCLUDED.abuse_registrar_email, cloudflare = EXCLUDED.cloudflare, consultado_em = now()
RETURNING dominio;""", (4, 0), "[JSON.stringify($json.rows || [])]", alwaysOutputData=True)
    code_inline(w, "Continuar una vez", "return [{ json: { ok: true } }];", (4.5, 0))

    # --- b) planificar
    pg(w, "Confirmados a notificar", """SELECT a.id, a.url, a.plataforma, a.nivel_escalado, a.notificado_em,
       o.titulo AS obra_titulo, o.isbn, o.urls_oficiais,
       c.id AS cliente_id, c.nome_autoral,
       lower(substring(a.url FROM '^https?://(?:www\\.)?([^/:?#]+)')) AS dominio,
       d.abuse_host_email, d.abuse_registrar_email, coalesce(d.cloudflare, false) AS cloudflare
FROM achados a
JOIN obras o ON o.id = a.obra_id
JOIN clientes c ON c.id = o.cliente_id
LEFT JOIN dominios d ON d.dominio = lower(substring(a.url FROM '^https?://(?:www\\.)?([^/:?#]+)'))
WHERE a.status = 'confirmado'
  AND c.assinado_em IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM notificacoes n
                  WHERE a.id = ANY (n.achado_ids) AND n.nivel = a.nivel_escalado AND n.status <> 'cancelada')
ORDER BY a.id
LIMIT 200;""", (5, 0))
    code(w, "Planificar", "ntf_planificar.js", (6, 0))
    pg(w, "Guardar notificaciones", """INSERT INTO notificacoes (cliente_id, canal, nivel, achado_ids, destinatario, asunto, corpo, status)
SELECT r.cliente_id, r.canal::canal_notif, r.nivel, ARRAY(SELECT jsonb_array_elements_text(r.achado_ids)::int),
       r.destinatario, r.asunto, r.corpo, r.status
FROM jsonb_to_recordset($1::jsonb) AS r(cliente_id int, canal text, nivel int, achado_ids jsonb, destinatario text, asunto text, corpo text, status text)
RETURNING id;""", (7, 0), "[JSON.stringify($json.rows || [])]")

    # --- c) enviar emails aprobados
    pg(w, "Emails aprobados", """SELECT n.id, n.destinatario, n.asunto, n.corpo,
       (SELECT valor FROM config WHERE chave = 'agente_email') AS agente_email
FROM notificacoes n
JOIN clientes c ON c.id = n.cliente_id
WHERE n.status = 'aprobada'
  AND n.canal IN ('host_abuse', 'telegram')
  AND c.assinado_em IS NOT NULL
  AND n.destinatario LIKE '%@%'
  AND coalesce((SELECT valor FROM config WHERE chave = 'dry_run'), 'true') = 'false'
ORDER BY n.id
LIMIT 20;""", (2, 2))
    w.add("Enviar email", "n8n-nodes-base.emailSend", 2.1, {
        "fromEmail": "={{ $json.agente_email }}", "toEmail": "={{ $json.destinatario }}",
        "subject": "={{ $json.asunto }}", "emailFormat": "text", "text": "={{ $json.corpo }}",
        "options": {"appendAttribution": False, "bccEmail": "={{ $json.agente_email }}",
                    "replyTo": "={{ $json.agente_email }}"}},
        (3, 2), CRED_SMTP, onError="continueErrorOutput")
    pg(w, "Marcar enviada", """WITH n AS (
  UPDATE notificacoes SET status = 'enviada', enviado_em = now() WHERE id = $1::int RETURNING achado_ids
)
UPDATE achados SET status = 'notificado', notificado_em = coalesce(notificado_em, now()), ultima_notificacao_em = now()
WHERE status IN ('confirmado', 'notificado') AND id IN (SELECT unnest(achado_ids) FROM n)
RETURNING id;""", (4, 2), "[$('Emails aprobados').item.json.id]")
    pg(w, "Marcar fallida", """UPDATE notificacoes SET status = 'fallida' WHERE id = $1::int
RETURNING id, asunto, (SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id') AS chat_id;""",
       (4, 3), "[$('Emails aprobados').item.json.id]")
    tg_send(w, "Avisar fallo", (5, 3), text="'⚠️ Falló el envío de la notificación #' + $json.id + ': ' + $json.asunto "
            "+ '\\nQuedó en estado fallida. Para reintentar: UPDATE notificacoes SET status=\\'aprobada\\' WHERE id=' + $json.id",
            buttons=False)

    for t in ("Cada 10 min", "Manual"):
        w.link(t, "Config")
    w.link("Config", "Dominios sin consultar")
    w.chain("Dominios sin consultar", "Consultar DNS y RDAP", "Guardar dominios", "Continuar una vez", "Confirmados a notificar")
    w.chain("Confirmados a notificar", "Planificar", "Guardar notificaciones")
    w.link("Config", "Emails aprobados")
    w.chain("Emails aprobados", "Enviar email")
    w.link("Enviar email", "Marcar enviada", 0)
    w.link("Enviar email", "Marcar fallida", 1)
    w.link("Marcar fallida", "Avisar fallo")
    w.save("04-notificaciones.json")


# ================================================================= 05 · verificación
def wf_verificacion():
    w = WF("Sentinela 05 · Verificacion")
    cron(w, "Cron 09:00", "0 9 * * *", (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "A verificar", """SELECT a.id AS achado_id, a.url, a.plataforma, a.nivel_escalado,
       floor(extract(epoch FROM now() - a.notificado_em) / 86400)::int AS dias,
       (SELECT count(*) FROM (SELECT ainda_no_ar, http_status FROM verificacoes v WHERE v.achado_id = a.id
                              ORDER BY v.checado_em DESC LIMIT 2) q
        WHERE q.ainda_no_ar IS NULL AND q.http_status IS NULL) AS nulos_previos
FROM achados a
WHERE a.status = 'notificado'
  AND a.notificado_em <= now() - interval '1 day'
  AND coalesce((SELECT max(v.checado_em) FROM verificacoes v WHERE v.achado_id = a.id), a.notificado_em)
      <= now() - interval '20 hours'
ORDER BY a.id
LIMIT 150;""", (1, 0))
    http_svc(w, "Chequear", "/chequear", "JSON.stringify({ url: $json.url })", (2, 0), timeout=60000, batch=(1, 500))
    merge_pos(w, "Unir chequeo", (3, 0))
    code(w, "Evaluar", "ver_evaluar.js", (4, 0))
    pg(w, "Registrar", """WITH v AS (
  INSERT INTO verificacoes (achado_id, http_status, ainda_no_ar, nota)
  VALUES ($1::int, NULLIF($2, '')::int, NULLIF($3, '')::boolean, $4) RETURNING id
)
UPDATE achados SET
  status = CASE $5::text WHEN 'removido' THEN 'removido'::achado_status
                         WHEN 'persistente' THEN 'persistente'::achado_status
                         WHEN 'escalar' THEN 'confirmado'::achado_status
                         ELSE status END,
  removido_em = CASE WHEN $5::text = 'removido' THEN now() ELSE removido_em END,
  dias_ate_remocao = CASE WHEN $5::text = 'removido'
                          THEN floor(extract(epoch FROM now() - notificado_em) / 86400)::int ELSE dias_ate_remocao END,
  nivel_escalado = CASE WHEN $5::text = 'escalar' THEN nivel_escalado + 1 ELSE nivel_escalado END
WHERE id = $1::int
RETURNING id, status, nivel_escalado;""", (5, 0),
       "[$json.achado_id, $json.http_status, $json.ainda_no_ar, $json.nota, $json.accion]")
    for t in ("Cron 09:00", "Manual"):
        w.link(t, "A verificar")
    w.link("A verificar", "Chequear"); w.link("A verificar", "Unir chequeo", 0, 0)
    w.link("Chequear", "Unir chequeo", 0, 1)
    w.chain("Unir chequeo", "Evaluar", "Registrar")
    w.save("05-verificacion.json")


# ================================================================= 06 · reporte semanal
REPORT_SQL = """WITH nuevos AS (
  SELECT a.id, a.url, a.plataforma, a.print_url, a.achado_em, o.titulo
  FROM achados a JOIN obras o ON o.id = a.obra_id
  WHERE o.cliente_id = $1::int AND a.achado_em >= now() - interval '7 days'
    AND a.status NOT IN ('novo', 'revisao', 'rejeitado')
), todos AS (
  SELECT a.* FROM achados a JOIN obras o ON o.id = a.obra_id
  WHERE o.cliente_id = $1::int AND a.status NOT IN ('novo', 'revisao', 'rejeitado')
), rem AS (
  SELECT * FROM todos WHERE removido_em >= now() - interval '7 days'
)
SELECT json_build_object(
  'cliente_id', c.id, 'cliente', c.nome_autoral, 'nome', c.nome, 'email', c.email,
  'desde', to_char(current_date - 7, 'DD/MM/YYYY'),
  'ate', to_char(current_date - 1, 'DD/MM/YYYY'),
  'novos', (SELECT count(*) FROM nuevos),
  'por_plataforma', coalesce((SELECT json_object_agg(plataforma, n) FROM (SELECT plataforma, count(*) AS n FROM nuevos GROUP BY 1) p), '{}'::json),
  'novos_lista', coalesce((SELECT json_agg(json_build_object('id', id, 'obra', titulo, 'url', url, 'plataforma', plataforma)
                           ORDER BY achado_em DESC) FROM (SELECT * FROM nuevos ORDER BY achado_em DESC LIMIT 40) x), '[]'::json),
  'ids_con_captura', coalesce((SELECT json_agg(id) FROM (SELECT id FROM nuevos WHERE print_url IS NOT NULL ORDER BY achado_em DESC LIMIT 12) y), '[]'::json),
  'notificacoes', coalesce((SELECT json_agg(json_build_object('canal', n.canal, 'quando', to_char(n.enviado_em, 'DD/MM'),
                           'links', array_length(n.achado_ids, 1)) ORDER BY n.enviado_em)
                           FROM notificacoes n WHERE n.cliente_id = $1::int AND n.enviado_em >= now() - interval '7 days'
                             AND n.status IN ('enviada', 'enviada_manual')), '[]'::json),
  'removidos_semana', (SELECT count(*) FROM rem),
  'dias_medios', (SELECT round(avg(dias_ate_remocao)::numeric, 1) FROM rem),
  'total_encontrado', (SELECT count(*) FROM todos),
  'total_removido', (SELECT count(*) FROM todos WHERE status = 'removido'),
  'persistentes', coalesce((SELECT json_agg(json_build_object('obra', o.titulo, 'url', t.url,
                           'dias', floor(extract(epoch FROM now() - t.notificado_em) / 86400)::int))
                           FROM todos t JOIN obras o ON o.id = t.obra_id WHERE t.status = 'persistente'), '[]'::json)
) AS datos
FROM clientes c WHERE c.id = $1::int;"""


def wf_reporte():
    w = WF("Sentinela 06 · Reporte semanal")
    cron(w, "Lunes 08:00", "0 8 * * 1", (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "Config", CFG_SQL, (1, 0))
    pg(w, "Clientes activos", "SELECT id FROM clientes WHERE status = 'ativo' AND assinado_em IS NOT NULL ORDER BY id;", (2, 0))
    pg(w, "Datos del reporte", REPORT_SQL, (3, 0), "[$json.id]")
    code(w, "Armar prompt resumen", "rep_prompt.js", (4, 0))
    http_ollama(w, "Ollama", (5, 0))
    merge_pos(w, "Unir frase", (6, 0))
    http_svc(w, "Capturas", "/capturas_b64", "JSON.stringify({ ids: $json.datos.ids_con_captura || [], ancho: 640 })",
             (7, 0), timeout=60000, batch=(1, 0))
    merge_pos(w, "Unir capturas", (8, 0))
    code(w, "Armar HTML", "rep_html.js", (9, 0))
    w.add("Gotenberg", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": GOTENBERG_URL + "/forms/chromium/convert/html",
        "sendBody": True, "contentType": "multipart-form-data",
        "bodyParameters": {"parameters": [
            {"parameterType": "formBinaryData", "name": "files", "inputDataFieldName": "data"},
            {"name": "paperWidth", "value": "8.27"}, {"name": "paperHeight", "value": "11.7"},
            {"name": "marginTop", "value": "0"}, {"name": "marginBottom", "value": "0.4"},
            {"name": "marginLeft", "value": "0"}, {"name": "marginRight", "value": "0"},
            {"name": "printBackground", "value": "true"}]},
        "options": {"timeout": 120000, "response": {"response": {"responseFormat": "file", "outputPropertyName": "pdf"}}}},
        (10, 0))
    code(w, "Nombrar PDF", "rep_pdf.js", (11, 0))
    w.add("Enviar reporte", "n8n-nodes-base.emailSend", 2.1, {
        "fromEmail": "={{ $('Config').first().json.cfg.agente_email }}",
        "toEmail": "={{ $('Config').first().json.cfg.dry_run === 'false' ? $json.email : $('Config').first().json.cfg.agente_email }}",
        "subject": "={{ ($('Config').first().json.cfg.dry_run === 'false' ? '' : '[DRY RUN, no enviado a la autora] ') + 'Relatório semanal · Sentinela Antipirataria · ' + $json.cliente }}",
        "emailFormat": "text",
        "text": "={{ 'Olá, ' + ($json.nome || '') + '!\\n\\nSegue em anexo o relatório semanal.\\n\\n' + $json.resumen3 + '\\n\\nQualquer dúvida, é só responder este e-mail.' }}",
        "attachments": "pdf",
        "options": {"appendAttribution": False, "bccEmail": "={{ $('Config').first().json.cfg.agente_email }}"}},
        (12, 0), CRED_SMTP)
    pg(w, "Registrar reporte", "INSERT INTO reportes (cliente_id, resumen) VALUES ($1::int, $2) RETURNING id;", (13, 0),
       "[$('Nombrar PDF').item.json.cliente_id, $('Nombrar PDF').item.json.resumen3]")
    tg_send(w, "Notify owner", (14, 0),
            chat="$('Config').first().json.cfg.telegram_admin_chat_id",
            text="($('Config').first().json.cfg.dry_run === 'false' ? '📨 Reporte enviado a ' : '🧪 DRY RUN: el reporte de ' ) + $('Nombrar PDF').item.json.cliente + ($('Config').first().json.cfg.dry_run === 'false' ? '.' : ' fue a tu email, no a la autora.') + '\\n\\nResumen para WhatsApp:\\n' + $('Nombrar PDF').item.json.resumen3",
            buttons=False)
    for t in ("Lunes 08:00", "Manual"):
        w.link(t, "Config")
    w.chain("Config", "Clientes activos", "Datos del reporte", "Armar prompt resumen")
    w.link("Armar prompt resumen", "Ollama"); w.link("Armar prompt resumen", "Unir frase", 0, 0)
    w.link("Ollama", "Unir frase", 0, 1)
    w.link("Unir frase", "Capturas"); w.link("Unir frase", "Unir capturas", 0, 0)
    w.link("Capturas", "Unir capturas", 0, 1)
    w.chain("Unir capturas", "Armar HTML", "Gotenberg", "Nombrar PDF", "Enviar reporte", "Registrar reporte", "Notify owner")
    w.save("06-reporte-semanal.json")


# ================================================================= 07 · mantenimiento Telegram
def wf_mantenimiento():
    w = WF("Sentinela 07 · Mantenimiento Telegram")
    cron(w, "Domingo 03:00", "0 3 * * 0", (0, 1))
    manual(w, "Manual", (0, 0))
    pg(w, "Config", CFG_SQL, (1, 0))
    # export de membresías
    http_svc(w, "Exportar grupos", "/export_dialogs", None, (2, 0), timeout=300000, method="GET")
    pg(w, "Guardar grupos", """INSERT INTO grupos_telegram (chat_id, titulo, username, tipo, miembros)
SELECT g.chat_id, g.titulo, g.username, g.tipo, g.miembros
FROM jsonb_to_recordset($1::jsonb) AS g(chat_id bigint, titulo text, username text, tipo text, miembros int)
ON CONFLICT (chat_id) DO UPDATE SET titulo = EXCLUDED.titulo, username = EXCLUDED.username,
  tipo = EXCLUDED.tipo, miembros = EXCLUDED.miembros, exportado_em = now()
RETURNING chat_id;""", (3, 0), "[JSON.stringify($json.grupos || [])]")
    # descubrimiento
    code(w, "Terminos", "mant_terminos.js", (2, 1))
    http_svc(w, "Descubrir canales", "/descubrir", "JSON.stringify($json)", (3, 1), timeout=600000)
    pg(w, "Guardar candidatos", """INSERT INTO grupos_candidatos (username, titulo, tipo, miembros, termino)
SELECT c.username, c.titulo, c.tipo, c.miembros, c.termino
FROM jsonb_to_recordset($1::jsonb) AS c(username text, titulo text, tipo text, miembros int, termino text, ya_miembro boolean)
WHERE NOT coalesce(c.ya_miembro, false)
ON CONFLICT (username) DO NOTHING
RETURNING username, titulo, miembros, (SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id') AS chat_id;""",
       (4, 1), "[JSON.stringify($json.canales || [])]")
    code(w, "Armar mensaje", "mant_msg.js", (5, 1))
    tg_send(w, "Avisar candidatos", (6, 1), buttons=False)
    for t in ("Domingo 03:00", "Manual"):
        w.link(t, "Config")
    w.link("Config", "Exportar grupos"); w.link("Config", "Terminos")
    w.chain("Exportar grupos", "Guardar grupos")
    w.chain("Terminos", "Descubrir canales", "Guardar candidatos", "Armar mensaje", "Avisar candidatos")
    w.save("07-mantenimiento-telegram.json")


# ================================================================= 08 · denuncias de lectoras
def wf_denuncias():
    w = WF("Sentinela 08 · Denuncia de lectoras")
    w.add("Formulario", "n8n-nodes-base.formTrigger", 2.2, {
        "formTitle": "Denunciar um link pirata",
        "formDescription": "Encontrou uma cópia pirata de um livro? Cole o link aqui. Vamos verificar e cuidar da remoção.",
        "formFields": {"values": [
            {"fieldLabel": "Titulo do livro", "requiredField": True},
            {"fieldLabel": "Link", "requiredField": True},
            {"fieldLabel": "Observacoes"}]},
        "options": {"buttonLabel": "Enviar denúncia", "appendAttribution": False}},
        (0, 0))
    code(w, "Normalizar", "form_norm.js", (1, 0))
    # El título escrito por la lectora puede contener el título real o al revés ("Livro X da autora").
    # Se escapan % y _ para que no actúen como comodines. Entra como 'novo': pasa por whitelist, LLM y captura.
    pg(w, "Guardar denuncia", """WITH entrada AS (
  SELECT lower(trim($1::text)) AS t
), obra AS (
  SELECT o.id
  FROM obras o, entrada e,
       LATERAL unnest(array_prepend(o.titulo, o.titulos_variantes)) AS v(titulo)
  WHERE o.ativa AND length(e.t) >= 3 AND length(trim(v.titulo)) >= 3
    AND (lower(v.titulo) LIKE '%' || replace(replace(replace(e.t, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
         OR e.t LIKE '%' || replace(replace(replace(lower(v.titulo), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
  ORDER BY length(v.titulo) DESC
  LIMIT 1
), limite AS (
  SELECT count(*) < 30 AS ok FROM achados WHERE motor = 'denuncia' AND achado_em > now() - interval '1 hour'
), ins AS (
  INSERT INTO achados (obra_id, url, url_hash, plataforma, motor, snippet, status, motivo)
  SELECT obra.id, $2::text, md5($2::text), $3::text, 'denuncia', left($4::text, 800), 'novo', 'denuncia de lectora'
  FROM obra, limite
  WHERE limite.ok
  ON CONFLICT (obra_id, url_hash) DO NOTHING
  RETURNING id
)
SELECT (SELECT id FROM ins) AS achado_id,
       (SELECT ok FROM limite) AS dentro_limite,
       EXISTS (SELECT 1 FROM obra) AND (SELECT ok FROM limite) AND NOT EXISTS (SELECT 1 FROM ins) AS duplicada,
       (SELECT valor FROM config WHERE chave = 'telegram_admin_chat_id') AS chat_id;""",
       (2, 0), "[$json.titulo, $json.url, $json.plataforma, $json.nota]")
    code(w, "Aviso si no entro", "form_aviso.js", (3, 0))
    tg_send(w, "Avisar denuncia", (4, 0), buttons=False)
    w.chain("Formulario", "Normalizar", "Guardar denuncia", "Aviso si no entro", "Avisar denuncia")
    w.save("08-denuncia-lectoras.json")


if __name__ == "__main__":
    for f in (wf_error, wf_deteccion, wf_triage, wf_bot, wf_notificaciones, wf_verificacion, wf_reporte,
              wf_mantenimiento, wf_denuncias):
        f()
    print("workflows generados en", OUT)
