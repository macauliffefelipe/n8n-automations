// @include common.js
// Entrada (Merge por posición): {username, obra_id, titulo} + HTML de t.me/s/<canal>?q=<titulo> en `data`.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const strip = (h) => String(h || '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const rows = [];
const errores = [];
for (const it of $input.all()) {
  const j = it.json;
  const html = String(j.data || '');
  if (j.error || !html) {
    errores.push(`@${j.username}: ${(j.error && (j.error.message || j.error)) || 'página sin vista pública'}`);
    continue;
  }
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const post = (b.match(/data-post="([^"]+)"/) || [])[1];
    if (!post) continue;
    const tm = b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const doc = b.match(/class="tgme_widget_message_document_title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = [doc && strip(doc[1]), tm && strip(tm[1])].filter(Boolean).join(' | ');
    if (!text || !norm(text).includes(norm(j.titulo))) continue;
    rows.push({
      obra_id: Number(j.obra_id),
      busca_id: null,
      url: `https://t.me/${post}`,
      plataforma: 'telegram',
      motor: 'telegram_public',
      snippet: text.slice(0, 800),
      es_frase: false,
    });
  }
}
return [{ json: { rows, fuente: 'Telegram (canales públicos)', consultas: $input.all().length, errores } }];
