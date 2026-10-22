// @include common.js
// Marca cada hallazgo como en_whitelist (tienda oficial, sitio de la autora, redes de lectores).
const out = [];
$input.all().forEach((it, i) => {
  const a = it.json;
  const host = hostOf(a.url);
  const nurl = normUrl(a.url) || a.url;
  const dom = (a.wl || []).find((d) => host === d || host.endsWith('.' + d));
  const oficial = (a.urls_oficiais || []).find((u) => {
    const n = normUrl(u);
    return n && nurl.startsWith(n);
  });
  const siteOficial = a.site_oficial && (host === a.site_oficial || host.endsWith('.' + a.site_oficial));
  const asinHit = a.asin && /(^|\.)amazon\./.test(host) && String(a.url).includes(a.asin);
  let motivo = null;
  if (dom) motivo = 'whitelist dominio ' + dom;
  else if (oficial) motivo = 'URL oficial de la obra';
  else if (siteOficial) motivo = 'sitio de la autora';
  else if (asinHit) motivo = 'ficha oficial de Amazon (ASIN)';
  out.push({
    json: {
      id: a.id, url: a.url, plataforma: a.plataforma, snippet: a.snippet, es_frase: a.es_frase,
      obra_titulo: a.obra_titulo, nome_autoral: a.nome_autoral,
      en_whitelist: !!motivo, wl_motivo: motivo,
    },
    pairedItem: { item: i },
  });
});
return out;
