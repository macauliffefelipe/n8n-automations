// Offline harness: runs the Code nodes of the SANITIZED workflows with mocked n8n globals.
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const REPO = path.join(__dirname, '..');
const wf = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));
const code = (w, name) => w.nodes.find((n) => n.name === name).parameters.jsCode;

function csv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const v = split(l); const o = {}; head.forEach((h, i) => (o[h] = v[i])); return { json: o }; });
}

async function run(js, { nodes = {}, input = [], staticData = {} } = {}) {
  const mk = (items) => ({ all: () => items, first: () => items[0], last: () => items[items.length - 1], itemMatching: (i) => items[i] });
  const $ = (name) => { if (!(name in nodes)) throw new Error(`Node "${name}" hasn't been executed`); return mk(nodes[name]); };
  const $input = mk(input);
  const fn = new Function('$', '$input', 'DateTime', '$getWorkflowStaticData', '$helpers', `return (async()=>{\n${js}\n})();`);
  return fn($, $input, DateTime, () => staticData, undefined);
}

let failures = 0;
const check = (label, cond, extra) => { if (!cond) failures++; console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond ? '' : '  ' + JSON.stringify(extra))); };

(async () => {
  // ================= PEPE =================
  const pepe = wf('expense-habit-bot/workflows/expense-habit-bot.json');
  const cfgHabitos = csv(REPO + '/expense-habit-bot/sheet-template/Config_Habitos.csv');
  const settingsOk = [{ json: { cfg_chat_id: '123456', cfg_name: 'Test User', cfg_greeting: 'che' } }];
  const settingsBad = [{ json: { cfg_chat_id: 'YOUR_TELEGRAM_CHAT_ID', cfg_name: 'X', cfg_greeting: 'che' } }];

  // User Lookup
  let r = await run(code(pepe, 'User Lookup'), { nodes: { Settings: settingsOk }, input: [{ json: { canal: 'telegram', from: '123456', chat_id: '123456', text: 'supe 5000' } }] });
  check('User Lookup: owner on Telegram is known', r[0].json.isKnownUser === true && r[0].json.user.greeting === 'che', r);
  r = await run(code(pepe, 'User Lookup'), { nodes: { Settings: settingsOk }, input: [{ json: { canal: 'telegram', from: '9999999', chat_id: '9999999', text: 'hola' } }] });
  check('User Lookup: stranger is NOT known', r[0].json.isKnownUser === false && r[0].json.user === null, r);
  r = await run(code(pepe, 'User Lookup'), { nodes: { Settings: settingsOk }, input: [{ json: { canal: 'telegram', from: '1234567', chat_id: '1234567', text: 'x' } }] });
  check('User Lookup: id containing owner id as substring is rejected', r[0].json.isKnownUser === false, r);
  r = await run(code(pepe, 'User Lookup'), { nodes: { Settings: settingsOk }, input: [{ json: { canal: 'iphone', from: '', chat_id: '', text: '8500 pasos' } }] });
  check('User Lookup: iPhone path gets owner chat_id', r[0].json.isKnownUser && r[0].json.chat_id === '123456', r);
  let threw = false;
  try { await run(code(pepe, 'User Lookup'), { nodes: { Settings: settingsBad }, input: [{ json: { canal: 'telegram', from: '1', chat_id: '1', text: 'x' } }] }); } catch (e) { threw = /Settings/.test(e.message); }
  check('User Lookup: unconfigured placeholder fails loudly', threw);

  // Detectar Intencion (rules router)
  const base = (text) => ({ json: { canal: 'telegram', from: '123456', chat_id: '123456', text, user: { name: 'Test User', greeting: 'che' }, isKnownUser: true } });
  const detect = async (text) => run(code(pepe, 'Detectar Intencion'), { nodes: { 'User Lookup': [base(text)], 'Leer Config Habitos': cfgHabitos } });
  const cases = [
    ['supe 50000', (o) => o[0].json.ruta === 'gasto' && o[0].json.categoria === 'Supermercado' && o[0].json.valor === 50000 && o[0].json.origen === 'reglas'],
    ['nafta 30 lucas ayer', (o) => o[0].json.categoria === 'Gasolina' && o[0].json.valor === 30000 && o[0].json.esHoy === false],
    ['salario 1500 usd', (o) => o[0].json.tipo === 'Ingreso' && o[0].json.moneda === 'USD' && o[0].json.valor === 1500],
    ['cobre 500 usd de un cliente', (o) => o[0].json.categoria === 'Freelance' && o[0].json.moneda === 'USD'],
    ['netflix 9000', (o) => o[0].json.categoria === 'Suscripciones'],
    ['mono 40000', (o) => o[0].json.categoria === 'Impuestos'],
    ['gym 45 min y agua 2l', (o) => o.length === 2 && o.every((x) => x.json.ruta === 'habito' && x.json.origen === 'reglas')],
    ['8500 pasos', (o) => o[0].json.ruta === 'habito' && o[0].json.habito === 'Pasos' && o[0].json.valor === 8500],
    ['borrá lo último', (o) => o[0].json.ruta === 'deshacer'],
    ['pague la cuota del gym 30000', (o) => o[0].json.ruta === 'gasto' && o[0].json.categoria === 'Gym'],
    ['compre una remera 25 lucas', (o) => o[0].json.ruta === 'llm'],
    ['hola', (o) => o[0].json.ruta === 'llm' || o[0].json.ruta === 'responder'],
  ];
  for (const [text, test] of cases) {
    const o = await detect(text);
    check(`Detectar Intencion: "${text}" -> ${o[0].json.ruta}${o[0].json.categoria ? '/' + o[0].json.categoria : ''}`, test(o), o.map((x) => x.json.ruta));
  }

  // Parse Agente (LLM output validation)
  const llmCtxItem = (await detect('compre una remera 25 lucas'))[0];
  const parse = async (out) => run(code(pepe, 'Parse Agente'), { nodes: { 'Detectar Intencion': [llmCtxItem] }, input: [{ json: { output: JSON.stringify(out) } }] });
  r = await parse({ tipo: 'plata', categoria: 'Categoria Inventada', detalle: 'remera', moneda: 'ARS', valor: 25000 });
  check('Parse Agente: unknown category falls back to Otro', r[0].json.categoria === 'Otro' && r[0].json.origen === 'llm' && r[0].json.ruta === 'gasto', r[0].json);
  r = await parse({ tipo: 'plata', categoria: 'Gym', detalle: '', moneda: 'ARS', valor: 10000 });
  const noNumber = (await run(code(pepe, 'Parse Agente'), { nodes: { 'Detectar Intencion': [{ json: { ...llmCtxItem.json, textoLimpio: 'pague la cuota del gym' } }] }, input: [{ json: { output: JSON.stringify({ tipo: 'plata', categoria: 'Gym', detalle: '', moneda: 'ARS', valor: 10000 }) } }] }));
  check('Parse Agente: invented amount (no number in message) is rejected', noNumber[0].json.ruta === 'responder' && noNumber[0].json.guardar === false, noNumber[0].json);

  // Armar Recordatorio
  const hoy = DateTime.now().setZone('America/Argentina/Buenos_Aires');
  const logRows = [{ json: { Fecha: hoy.toFormat('yyyy-MM-dd'), Dia: hoy.day, Mes: hoy.month, Anio: hoy.year, Habito: 'Agua', Valor: 2, Unidad: 'L', Cumple: 'SI' } }];
  r = await run(code(pepe, 'Armar Recordatorio'), { nodes: { Settings: settingsOk, 'Leer Config': cfgHabitos }, input: logRows });
  check('Armar Recordatorio: builds message for owner chat', r[0].json.chat_id === '123456' && /Te faltan hoy/.test(r[0].json.reply) && !/Agua/.test(r[0].json.reply.split('Semana')[0]), r[0].json.reply);

  // Connections sanity for Pepe: all three entry points pass through Settings
  const C = pepe.connections;
  check('Pepe wiring: Telegram, iPhone and 19:00 all go to Settings',
    ['Extraer Datos', 'Desde iPhone', 'Todos los dias 19:00'].every((n) => C[n].main[0][0].node === 'Settings'));
  check('Pepe wiring: unknown users are ignored (no reply node)', C['Switch Conocido?'].main[1].length === 0 && !pepe.nodes.some((n) => n.name === 'Rechazar Desconocido'));

  // ================= JOB SEARCH =================
  const js = wf('job-search-pipeline/workflows/job-discovery.json');
  const prompts = [
    { json: { clave: 'a|ops', empresa: 'A', puesto: 'RevOps Analyst', desc: 'hubspot, n8n. contractor', region: 'LATAM', fuente: 'X', link: 'https://example.com/a', publicado: '' } },
    { json: { clave: 'b|ops', empresa: 'B', puesto: 'Sales Ops', desc: 'remote us only', region: 'Remote (US only)', fuente: 'X', link: 'https://example.com/b', publicado: '' } },
    { json: { clave: 'c|ops', empresa: 'C', puesto: 'BizOps Manager', desc: '5 years', region: 'LATAM', fuente: 'X', link: 'https://example.com/c', publicado: '' } },
    { json: { clave: 'd|ops', empresa: 'D', puesto: 'Automation Specialist', desc: 'n8n zapier', region: 'LATAM', fuente: 'X', link: 'https://example.com/d', publicado: '' } },
  ];
  const ollama = (obj) => ({ json: { message: { content: JSON.stringify(obj) } } });
  const ext = (o) => ({ familia_rol: 'revops_salesops_bizops', anios_requeridos: null, requiere_documentos_us: false, paises_permitidos: [], herramientas: [], pago_usd_mes: null, contrato: 'no_dice', motivo: 'm', ...o });
  const outputs = [
    ollama(ext({ herramientas: ['hubspot', 'n8n'], anios_requeridos: 2, contrato: 'contractor', pago_usd_mes: 2500 })),
    ollama(ext({ paises_permitidos: ['Remote (US only)'] })),
    ollama(ext({ anios_requeridos: 5 })),
    { json: { error: 'timeout' } },       // simulated Ollama failure on item 4
  ];
  r = await run(code(js, 'Puntuar'), { nodes: { 'Armar prompt empleo': prompts }, input: outputs, staticData: {} });
  check('Puntuar: good ad scores >= 6', r[0].json.resultado === 'ok' && r[0].json.score >= 6, r[0].json);
  check('Puntuar: "Remote (US only)" is discarded by country', r[1].json.resultado === 'descartado_pais', r[1].json);
  check('Puntuar: 5 years required is discarded', r[2].json.resultado === 'descartado_anios', r[2].json);
  check('Puntuar: Ollama failure -> sin_evaluar, still aligned to the right company', r[3].json.resultado === 'sin_evaluar' && r[3].json.empresa === 'D', r[3].json);

  // Armar digest + Check last run (heartbeat)
  const sd = { diag: { total: 40, nuevos: 12, fecha: new Date().toISOString(), por_fuente: { Remotive: 10 }, errores: [] } };
  const digest = await run(code(js, 'Armar digest'), { input: r.map((x) => ({ json: x.json })), staticData: sd });
  check('Armar digest: produces a message and records the digest day', typeof digest[0].json.mensaje === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sd.digest_fecha), sd);
  let hb = await run(code(js, 'Check last run'), { staticData: sd });
  check('Heartbeat: silent when today\'s digest went out', hb.length === 0, hb);
  hb = await run(code(js, 'Check last run'), { staticData: { diag: { total: 0, nuevos: 0, fecha: new Date().toISOString(), errores: ['Remotive: HTTP 500'] } } });
  check('Heartbeat: reports source errors when no digest', hb.length === 1 && /Problemas en fuentes/.test(hb[0].json.mensaje), hb);
  hb = await run(code(js, 'Check last run'), { staticData: { diag: { fecha: '2020-01-01T00:00:00Z' } } });
  check('Heartbeat: alarms when the run did not happen today', hb.length === 1 && /no se ejecut/.test(hb[0].json.mensaje), hb);

  // Filtrar y deduplicar
  const buscar = [
    { json: { clave: 'a|ops', empresa: 'A', puesto: 'RevOps Analyst', desc: 'x', region: 'LATAM', fuente: 'X', link: 'l1' } },
    { json: { clave: 'seen|x', empresa: 'S', puesto: 'Seen', desc: 'x', region: '', fuente: 'X', link: 'l2' } },
    { json: { clave: 'e|ux', empresa: 'E', puesto: 'UX Designer', desc: 'x', region: 'LATAM', fuente: 'X', link: 'l3' } },
    { json: { clave: 'f|ops', empresa: 'F', puesto: 'Ops Manager', desc: 'must reside in the united states', region: 'LATAM', fuente: 'X', link: 'l4' } },
    { json: { clave: 'g|ops', empresa: 'G', puesto: 'Ops Manager', desc: 'x', region: 'Europe only', fuente: 'X', link: 'l5' } },
  ];
  r = await run(code(js, 'Filtrar y deduplicar'), { nodes: { 'Leer vistos': [{ json: { clave: 'seen|x' } }] }, input: buscar, staticData: {} });
  const res = Object.fromEntries(r.map((x) => [x.json.clave, x.json.resultado]));
  check('Filtrar: already-seen ad is skipped', !('seen|x' in res), res);
  check('Filtrar: good ad passes, UX/US-only/Europe-only are discarded', res['a|ops'] === 'ok' && res['e|ux'] === 'descartado_rubro' && res['f|ops'] === 'descartado_region' && res['g|ops'] === 'descartado_region', res);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL HARNESS CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
