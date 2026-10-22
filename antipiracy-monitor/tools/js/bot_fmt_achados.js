// @include common.js
// Un mensaje de Telegram por hallazgo en cola de revisión, con botones Aprobar / Rechazar.
const out = [];
$input.all().forEach((it, i) => {
  const a = it.json;
  if (!a.chat_id) return;   // falta configurar telegram_admin_chat_id
  const conf = a.confianza == null ? 's/d' : Number(a.confianza).toFixed(2);
  const lineas = [
    `<b>🔎 Hallazgo #${a.id}</b> · ${esc(a.plataforma)}`,
    `Obra: <b>${esc(a.obra)}</b> (${esc(a.nome_autoral)})`,
    `URL: ${esc(a.url)}`,
    `Confianza: ${conf} · tipo: ${esc(a.tipo || 's/d')}`,
    a.motivo ? `Motivo: ${esc(a.motivo)}` : null,
    a.snippet ? `Texto: <i>${esc(a.snippet)}</i>` : null,
    a.con_captura ? '📸 captura guardada' : '📸 sin captura',
    a.sin_autorizacion ? '⚠️ <b>Cliente SIN autorización firmada: no se va a notificar nada hasta cargarla.</b>' : null,
  ].filter(Boolean);
  out.push({
    json: {
      id: a.id,
      chat_id: String(a.chat_id),
      texto: lineas.join('\n').slice(0, 3900),
      b1_text: '✅ Aprobar', b1_data: `ap:${a.id}`,
      b2_text: '❌ Rechazar', b2_data: `re:${a.id}`,
    },
    pairedItem: { item: i },
  });
});
return out;
