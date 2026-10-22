// Entrada (Merge por posición): item del prompt + respuesta de Ollama (message.content).
// Decide el estado. Con umbral_auto y umbral_rechazo en 1.01 (default) nada se confirma ni se descarta solo:
// todo va a la cola humana. Si Ollama no respondió, el hallazgo queda en 'novo' para reintentarlo.
const cfg = $('Config').first().json.cfg || {};
const umbral = parseFloat(cfg.umbral_auto || '1.01');
// Descarte automático: con 1.01 (default) nada se descarta solo. Un descarte es definitivo (la URL no vuelve a entrar).
const umbralRechazo = parseFloat(cfg.umbral_rechazo || '1.01');
const TIPOS = ['pdf_direto', 'agregador', 'grupo_telegram', 'listing', 'otro'];

return $input.all().map((it, i) => {
  const j = it.json;
  // Ollama caído (timeout, Mac mini dormida, túnel cortado): el hallazgo queda en 'novo' y se reintenta en la próxima corrida.
  if (j.error && !j.message) {
    return { json: { id: j.id, url: j.url, status: 'novo', confianca: null, tipo: null, motivo: null, sin_llm: true }, pairedItem: { item: i } };
  }
  let r = null;
  try {
    let c = (j.message && j.message.content) || '';
    c = String(c).replace(/```json|```/g, '').trim();
    const m = c.match(/\{[\s\S]*\}/);
    r = JSON.parse(m ? m[0] : c);
  } catch (e) { r = null; }

  let infractor = !!r && (r.infractor === true || r.infractor === 'true');
  let conf = r ? parseFloat(r.confianza) : 0;
  if (isNaN(conf)) conf = 0;
  conf = Math.min(1, Math.max(0, conf));
  const tipo = r && TIPOS.includes(r.tipo) ? r.tipo : 'otro';
  let motivo = r ? String(r.motivo || '').slice(0, 300) : 'LLM sin respuesta válida: revisar a mano';

  // Coincidencia de frase exacta del interior del libro: evidencia fuerte (casi cero falsos positivos).
  if (r && j.es_frase && infractor) {
    conf = Math.max(conf, 0.9);
    motivo += ' [coincide frase exacta del libro]';
  }

  let status;
  if (!r) status = 'revisao';
  else if (!infractor && conf >= umbralRechazo) status = 'rejeitado';
  else if (infractor && conf >= umbral) status = 'confirmado';
  else status = 'revisao';

  return { json: { id: j.id, url: j.url, status, confianca: conf, tipo, motivo, sin_llm: false }, pairedItem: { item: i } };
});
