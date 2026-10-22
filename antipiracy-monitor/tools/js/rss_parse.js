// @include common.js
// Entrada (Merge por posición): fila de alertas_rss (obra_id) + respuesta de texto del feed en `data`.
const rows = [];
const errores = [];
for (const it of $input.all()) {
  const j = it.json;
  const xml = String(j.data || '');
  if (j.error || !xml.includes('<feed')) {
    errores.push(`feed ${j.id}: ${(j.error && (j.error.message || j.error)) || 'no es un feed Atom'}`);
    continue;
  }
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    if (!link) continue;
    let real = link.replace(/&amp;/g, '&');
    try {
      const u = new URL(real);
      const inner = u.searchParams.get('url');
      if (inner) real = inner;
    } catch (err) { /* link directo */ }
    const url = normUrl(real);
    if (!url) continue;
    const title = ((e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/&lt;[^&]*&gt;/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    const body = ((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '').replace(/&lt;[^&]*&gt;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    rows.push({
      obra_id: Number(j.obra_id),
      busca_id: null,
      url,
      plataforma: platformOf(hostOf(url)),
      motor: 'google_alerts',
      snippet: [title, body].filter(Boolean).join(' | ').slice(0, 800),
      es_frase: false,
    });
  }
}
return [{ json: { rows, fuente: 'Google Alerts', consultas: $input.all().length, errores } }];
