// @include common.js
// Entrada (Merge por posición): busca (busca_id, obra_id, es_frase) + respuesta de /buscar (resultados).
const rows = [];
const buscaIds = [];
const errores = [];
const SOSPECHOSO = /\.(pdf|epub|mobi|azw3?)\b|baixar|download|drive\.google|mega\.nz|t\.me\/\+/i;
for (const it of $input.all()) {
  const j = it.json;
  if (!Array.isArray(j.resultados) || !j.busca_id) {   // error de la llamada: se reintenta mañana
    errores.push((j.error && (j.error.message || j.error)) || j.detail || 'sin resultados del servicio');
    continue;
  }
  buscaIds.push(Number(j.busca_id));
  for (const r of j.resultados) {
    const texto = r.texto || '';
    const sospechoso = r.es_libro || SOSPECHOSO.test(texto + ' ' + (r.archivo || ''));
    if (!(sospechoso || j.es_frase)) continue;
    rows.push({
      obra_id: Number(j.obra_id),
      busca_id: Number(j.busca_id),
      url: r.url,
      plataforma: 'telegram',
      motor: 'telegram',
      snippet: [r.canal_titulo, r.archivo, texto].filter(Boolean).join(' | ').slice(0, 800),
      es_frase: !!j.es_frase,
    });
  }
}
return [{ json: { rows, busca_ids: buscaIds, fuente: 'Telegram (cuenta sentinela)', consultas: $input.all().length, errores } }];
