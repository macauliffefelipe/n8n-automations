// @include common.js
// Para cada dominio: DNS (DoH) -> RDAP de la IP (abuse del host, Cloudflare) -> RDAP del dominio (abuse del registrador).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => H.httpRequest({ method: 'GET', url, json: true, timeout: 12000,
  headers: { Accept: 'application/rdap+json, application/json' } });

function abuseEmail(rdap) {
  const found = [];
  const walk = (ents) => {
    for (const e of ents || []) {
      if ((e.roles || []).includes('abuse')) {
        for (const f of ((e.vcardArray || [])[1]) || []) {
          if (f[0] === 'email' && f[3]) found.push(String(f[3]));
        }
      }
      walk(e.entities);
    }
  };
  walk(rdap && rdap.entities);
  return found[0] || null;
}

function registrable(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  const SLD = new Set(['com', 'org', 'net', 'gov', 'edu', 'co', 'ne', 'or', 'ac', 'mil']);
  if (p[p.length - 1].length === 2 && SLD.has(p[p.length - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

const rows = [];
for (const it of $input.all()) {
  const dominio = String(it.json.dominio || '').toLowerCase();
  if (!dominio) continue;
  let ip = null, hostNome = null, abuseHost = null, cf = false, registrar = null, abuseReg = null;
  try {
    const d = await get(`https://dns.google/resolve?name=${encodeURIComponent(dominio)}&type=A`);
    const a = (d.Answer || []).find((x) => x.type === 1);
    ip = a ? a.data : null;
  } catch (e) { /* sin DNS */ }
  if (ip) {
    try {
      const r = await get(`https://rdap.org/ip/${ip}`);
      hostNome = r.name || r.handle || null;
      abuseHost = abuseEmail(r);
      cf = /cloudflare/i.test(`${r.name || ''} ${r.handle || ''}`);
    } catch (e) { /* RDAP no disponible */ }
  }
  try {
    const r = await get(`https://rdap.org/domain/${registrable(dominio)}`);
    abuseReg = abuseEmail(r);
    const reg = (r.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const fn = reg && ((reg.vcardArray || [])[1] || []).find((f) => f[0] === 'fn');
    registrar = fn ? fn[3] : null;
  } catch (e) { /* RDAP no disponible */ }
  rows.push({ dominio, ip, host_nome: hostNome, abuse_host_email: abuseHost, registrar, abuse_registrar_email: abuseReg, cloudflare: cf });
  await sleep(400);
}
return [{ json: { rows } }];
