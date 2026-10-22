// @include common.js
// Un mensaje por notificación: emails esperan "Enviar"; los canales manuales traen el bloque listo para pegar.
const out = [];
$input.all().forEach((it, i) => {
  const n = it.json;
  if (!n.chat_id) return;
  const manual = n.status === 'pendente_manual';
  const cuerpo = String(n.corpo || '');
  const recorte = cuerpo.length > 2600 ? cuerpo.slice(0, 2600) + '\n[...recortado, completo en la tabla notificacoes]' : cuerpo;
  const cab = manual
    ? `<b>📋 Para enviar a mano #${n.id}</b> · ${esc(n.canal)} · ${n.n_urls} URL(s)${n.nivel > 0 ? ' · ESCALADO' : ''}`
    : `<b>✉️ Email para aprobar #${n.id}</b> · ${esc(n.canal)} · ${n.n_urls} URL(s)${n.nivel > 0 ? ' · ESCALADO' : ''}`;
  const lineas = [
    cab,
    n.destinatario ? `Para: ${esc(n.destinatario)}` : null,
    n.asunto ? `Asunto: ${esc(n.asunto)}` : null,
    !manual && n.dry_run !== 'false' ? '🧪 <b>DRY RUN activo:</b> aunque aprietes Enviar, el email NO sale hasta poner dry_run=false en la tabla config.' : null,
    '',
    `<pre>${esc(recorte)}</pre>`,
  ].filter((x) => x !== null);
  out.push({
    json: {
      id: n.id,
      chat_id: String(n.chat_id),
      texto: lineas.join('\n').slice(0, 4000),
      b1_text: manual ? '✅ Marcar enviada' : '📤 Enviar', b1_data: manual ? `em:${n.id}` : `se:${n.id}`,
      b2_text: '🚫 Cancelar', b2_data: `cn:${n.id}`,
    },
    pairedItem: { item: i },
  });
});
return out;
