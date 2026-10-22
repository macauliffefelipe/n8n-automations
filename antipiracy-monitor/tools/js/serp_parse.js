// @include common.js
// Entrada: una respuesta de DataForSEO por item. Salida: 1 item con todas las filas para insertar.
const rows = [];
const buscaIds = new Set();
const errores = [];
for (const it of $input.all()) {
  const j = it.json;
  const task = j && j.tasks && j.tasks[0];
  if (!task || task.status_code !== 20000) {
    errores.push((task && task.status_message) || j.status_message || (j.error && (j.error.message || j.error)) || 'respuesta vacía');
    continue;
  }
  const [buscaId, obraId, esFrase] = String((task.data && task.data.tag) || '').split('|');
  if (!buscaId || !obraId) continue;
  buscaIds.add(Number(buscaId));
  const items = (task.result && task.result[0] && task.result[0].items) || [];
  for (const r of items) {
    if (r.type !== 'organic' || !r.url) continue;
    const url = normUrl(r.url);
    if (!url) continue;
    rows.push({
      obra_id: Number(obraId),
      busca_id: Number(buscaId),
      url,
      plataforma: platformOf(hostOf(url)),
      motor: 'serp',
      snippet: [r.title, r.description].filter(Boolean).join(' | ').slice(0, 800),
      es_frase: esFrase === '1',
    });
  }
}
return [{ json: { rows, busca_ids: [...buscaIds], fuente: 'Google (DataForSEO)', consultas: $input.all().length, errores } }];
