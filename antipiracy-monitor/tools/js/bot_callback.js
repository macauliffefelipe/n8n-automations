// Entrada: fila con el admin id (config) tras el Telegram Trigger de callback_query.
const cq = ($('Telegram Trigger').first().json || {}).callback_query;
const admin = String(($input.first().json || {}).valor || '').trim();
if (!cq) return [];
const base = { query_id: cq.id, chat_id: cq.message && cq.message.chat && cq.message.chat.id, message_id: cq.message && cq.message.message_id };
const m = String(cq.data || '').match(/^(ap|re|se|cn|em):(\d+)$/);
const autorizado = admin !== '' && String(cq.from && cq.from.id) === admin;
if (!autorizado || !m) {
  return [{ json: { ...base, ok: false, answer_text: autorizado ? 'Acción no reconocida' : 'No autorizado' } }];
}
return [{ json: { ...base, ok: true, accion: m[1], id: Number(m[2]), texto_original: (cq.message && cq.message.text) || '' } }];
