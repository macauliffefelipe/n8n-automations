// @include common.js
// Entrada: resultado de "Guardar denuncia". Avisa por Telegram solo cuando la denuncia NO entró a la cola
// (título que no coincide con ninguna obra, o límite por hora alcanzado), para que no se pierda en silencio.
const r = $input.first().json || {};
const d = $('Normalizar').first().json;
const chat = String(r.chat_id || '').trim();
if (!chat || r.achado_id || r.duplicada) return [];
const motivo = !r.dentro_limite
  ? 'se alcanzó el límite de denuncias por hora (posible spam). No se guardó.'
  : 'el título no coincide con ninguna obra activa. No se guardó; si es válida, cargala a mano.';
return [{
  json: {
    chat_id: chat,
    texto: `📝 <b>Denuncia de lectora sin procesar</b>: ${motivo}\nTítulo escrito: ${esc(d.titulo)}\nLink: ${esc(d.url)}${d.nota ? `\nNota: ${esc(d.nota)}` : ''}`.slice(0, 3900),
  },
}];
