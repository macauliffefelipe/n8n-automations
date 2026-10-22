// @include common.js
// Entrada: salida de un parser de detección (fuente, consultas, errores[]). Avisa si alguna consulta falló,
// porque los nodos HTTP siguen de largo ante errores y el workflow 00 no se entera (crédito agotado, sesión caída...).
const cfg = $('Config').first().json.cfg || {};
const chat = String(cfg.telegram_admin_chat_id || '').trim();
const j = $input.first().json || {};
const errores = j.errores || [];
if (!chat || !errores.length) return [];
const distintos = [...new Set(errores.map((e) => String(e).slice(0, 160)))].slice(0, 3);
return [{
  json: {
    chat_id: chat,
    texto: `⚠️ <b>Detección · ${esc(j.fuente)}</b>: fallaron ${errores.length} de ${j.consultas} consultas.\n`
      + distintos.map((e) => `• ${esc(e)}`).join('\n'),
  },
}];
