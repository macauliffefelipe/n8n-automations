// Entrada: resultado del UPDATE (achados / notifs afectados). Arma la respuesta al botón y el texto nuevo del mensaje.
const cb = $('Parsear callback').first().json;
const r = $input.first().json || {};
const hecho = Number(r.achados || 0) + Number(r.notifs || 0) > 0;
const ETIQUETA = {
  ap: '✅ APROBADO', re: '❌ RECHAZADO', se: '📤 APROBADO PARA ENVIAR', cn: '🚫 CANCELADO', em: '✅ MARCADA COMO ENVIADA',
};
const etiqueta = hecho ? ETIQUETA[cb.accion] : '↩️ YA PROCESADO ANTES';
return [{
  json: {
    query_id: cb.query_id,
    chat_id: cb.chat_id,
    message_id: cb.message_id,
    answer_text: hecho ? 'Listo' : 'Ya estaba procesado',
    nuevo_texto: `${etiqueta} (#${cb.id})\n\n${cb.texto_original}`.slice(0, 4000),
  },
}];
