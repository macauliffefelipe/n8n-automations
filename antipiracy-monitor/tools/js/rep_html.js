// @include common.js
// Entrada (2 Merge por posición): datos + respuesta de Ollama + imágenes (data-URI). Salida: HTML como binario + resumen.
const CANAL = {
  google_search: 'Google Busca (desindexação)', host_abuse: 'Provedor de hospedagem / site', telegram: 'Telegram',
  scribd: 'Scribd / Docero / Passei Direto', mercado_livre: 'Mercado Livre', amazon: 'Amazon', cloudflare: 'Cloudflare', meta: 'Meta',
};
const PLAT = {
  telegram: 'Telegram', web: 'Sites e blogs', scribd: 'Scribd', docero: 'Docero', passeidireto: 'Passei Direto',
  '4shared': '4shared', mediafire: 'MediaFire', mercadolivre: 'Mercado Livre', amazon: 'Amazon', drive: 'Google Drive',
};
const n = (x) => (x == null ? 0 : Number(x));

const out = [];
for (let i = 0; i < $input.all().length; i++) {
  const j = $input.all()[i].json;
  const d = j.datos || {};
  let frase = '';
  try {
    const c = String((j.message && j.message.content) || '').replace(/```json|```/g, '').trim();
    frase = String(JSON.parse(c.match(/\{[\s\S]*\}/)[0]).frase || '').trim();
  } catch (e) { frase = ''; }
  if (!frase) {
    frase = `Nesta semana encontramos ${n(d.novos)} novo(s) link(s) com cópias não autorizadas, enviamos ${(d.notificacoes || []).length} notificação(ões) e ${n(d.removidos_semana)} link(s) foram removidos.`;
  }
  const imgs = j.imagenes || {};
  const tasa = n(d.total_encontrado) ? Math.round((100 * n(d.total_removido)) / n(d.total_encontrado)) : 0;

  const filasPlat = Object.entries(d.por_plataforma || {}).sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `<tr><td>${esc(PLAT[p] || p)}</td><td class="num">${c}</td></tr>`).join('')
    || '<tr><td colspan="2" class="vacio">Nenhum link novo esta semana.</td></tr>';
  const filasNotif = (d.notificacoes || [])
    .map((x) => `<tr><td>${esc(x.quando)}</td><td>${esc(CANAL[x.canal] || x.canal)}</td><td class="num">${n(x.links)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="vacio">Nenhuma notificação enviada esta semana.</td></tr>';
  const filasPers = (d.persistentes || [])
    .map((x) => `<tr><td>${esc(x.obra)}</td><td class="url">${esc(x.url)}</td><td class="num">${n(x.dias)} d</td></tr>`).join('');
  const comCaptura = (d.novos_lista || []).filter((x) => imgs[String(x.id)]).slice(0, 12);
  const galeria = comCaptura.map((x) => `<figure><img src="${imgs[String(x.id)]}"><figcaption>${esc(x.obra)}<br><span class="url">${esc(x.url)}</span></figcaption></figure>`).join('');

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
:root{--ink:#1c2430;--mut:#667085;--acc:#1f3a5f;--bg:#f6f7f9;--line:#e3e6eb;--ok:#1b7f4b;--warn:#b54708}
*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',serif;color:var(--ink);margin:0;font-size:12.5px;line-height:1.5}
header{background:var(--acc);color:#fff;padding:26px 34px}header h1{margin:0 0 4px;font-size:22px;font-weight:600}
header p{margin:0;opacity:.85;font-family:Helvetica,Arial,sans-serif;font-size:12px}
main{padding:24px 34px}.frase{font-size:15px;border-left:4px solid var(--acc);padding:6px 14px;margin:0 0 22px;background:var(--bg)}
.cards{display:flex;gap:10px;margin-bottom:24px}.card{flex:1;border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.card b{display:block;font-size:26px;color:var(--acc);font-family:Helvetica,Arial,sans-serif}.card span{color:var(--mut);font-family:Helvetica,Arial,sans-serif;font-size:11px}
h2{font-size:14px;margin:26px 0 8px;color:var(--acc);text-transform:uppercase;letter-spacing:.06em;font-family:Helvetica,Arial,sans-serif}
table{width:100%;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:11.5px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:600}
.num{text-align:right;white-space:nowrap}.vacio{color:var(--mut);font-style:italic}.url{word-break:break-all;color:var(--mut);font-size:10.5px}
.gal{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:calc(50% - 6px);break-inside:avoid;border:1px solid var(--line);border-radius:6px;overflow:hidden}
figure img{width:100%;display:block}figcaption{padding:6px 8px;font-family:Helvetica,Arial,sans-serif;font-size:10.5px}
.pers{color:var(--warn)}footer{padding:18px 34px;color:var(--mut);font-family:Helvetica,Arial,sans-serif;font-size:10.5px;border-top:1px solid var(--line)}
</style></head><body>
<header><h1>Relatório semanal · Sentinela Antipirataria</h1><p>${esc(d.cliente)} · ${esc(d.desde)} a ${esc(d.ate)}</p></header>
<main>
<p class="frase">${esc(frase)}</p>
<div class="cards">
<div class="card"><b>${n(d.novos)}</b><span>links novos encontrados</span></div>
<div class="card"><b>${n(d.removidos_semana)}</b><span>links removidos na semana</span></div>
<div class="card"><b>${d.dias_medios == null ? '–' : esc(d.dias_medios)}</b><span>dias médios até a remoção</span></div>
<div class="card"><b>${tasa}%</b><span>taxa de remoção acumulada</span></div>
</div>
<h2>Novos links por plataforma</h2><table><tr><th>Plataforma</th><th class="num">Links</th></tr>${filasPlat}</table>
${galeria ? `<h2>Evidências desta semana</h2><div class="gal">${galeria}</div>` : ''}
<h2>Notificações enviadas</h2><table><tr><th>Data</th><th>Destino</th><th class="num">Links</th></tr>${filasNotif}</table>
<h2>Acumulado histórico</h2><table>
<tr><td>Total de links encontrados</td><td class="num">${n(d.total_encontrado)}</td></tr>
<tr><td>Total removidos</td><td class="num">${n(d.total_removido)}</td></tr>
<tr><td>Taxa de remoção</td><td class="num">${tasa}%</td></tr></table>
<h2 class="pers">Casos persistentes</h2>
${filasPers ? `<p>Links que seguem no ar após 30 dias de notificação. Seguimos escalando cada caso.</p><table><tr><th>Obra</th><th>Link</th><th class="num">Dias</th></tr>${filasPers}</table>` : '<p class="vacio">Nenhum caso persistente no momento.</p>'}
</main><footer>FMA Solutions · Sentinela Antipirataria. Cada link é verificado manualmente antes de ser notificado.</footer>
</body></html>`;

  const resumen3 = `📚 ${d.cliente}: resumo da semana (${d.desde} a ${d.ate})\n`
    + `🔎 ${n(d.novos)} novos links · 📨 ${(d.notificacoes || []).length} notificações · ✅ ${n(d.removidos_semana)} removidos\n`
    + `📈 Acumulado: ${n(d.total_removido)} de ${n(d.total_encontrado)} removidos (${tasa}%). Relatório completo no seu e-mail.`;

  out.push({
    json: { email: d.email, nome: d.nome, cliente: d.cliente, cliente_id: d.cliente_id, hasta: d.ate, resumen3 },
    binary: { data: await H.prepareBinaryData(Buffer.from(html, 'utf8'), 'index.html', 'text/html') },
    pairedItem: { item: i },
  });
}
return out;
