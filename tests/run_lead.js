// Offline harness for the lead-gen workflow Code nodes (mocked n8n globals).
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const REPO = path.join(__dirname, '..', 'lead-gen-pipeline');
const wf = JSON.parse(fs.readFileSync(path.join(REPO, 'workflows/lead-gen.json'), 'utf8'));
const prof = (k) => JSON.parse(fs.readFileSync(path.join(REPO, `config/profile-${k}.json`), 'utf8'));
const lane = (p, l) => Object.assign({}, p.shared, p[l]);
const code = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

async function run(name, { nodes = {}, input = [], staticData = {} } = {}) {
  const mk = (items) => ({ all: () => items, first: () => items[0], last: () => items[items.length - 1], itemMatching: (i) => items[i] });
  const $ = (n) => { if (!(n in nodes)) throw new Error(`Node "${n}" hasn't been executed`); return mk(nodes[n]); };
  const fn = new Function('$', '$input', 'DateTime', '$getWorkflowStaticData', `return (async()=>{\n${code(name)}\n})();`);
  return fn($, mk(input), DateTime, () => staticData);
}
let failures = 0;
const check = (label, cond, extra) => { if (!cond) failures++; console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond ? '' : '  ' + JSON.stringify(extra))); };
const J = (o) => ({ json: o });
const cfgNode = (c) => [J({ cfg: c })];
const today = DateTime.now().setZone('America/Argentina/Buenos_Aires');
const iso = (dt) => dt.toFormat('yyyy-MM-dd');

(async () => {
  const b2b = prof('b2b-services-consultancy'), fma = prof('fma-solutions');

  // ---- Config node passes items through and attaches cfg
  let r = await run('Config (outreach)', { input: [J({ a: 1 }), J({ a: 2 })] });
  check('Config: keeps payload and attaches cfg to every item', r.length === 2 && r[1].json.a === 2 && r[0].json.cfg.send.mode === 'review' && r[0].json.cfg.sender.name, r[0]);
  r = await run('Config (replies)', { input: [J({ subject: 'hi' })] });
  check('Config (replies): carries the email plus replies settings', r[0].json.subject === 'hi' && Array.isArray(r[0].json.cfg.own_emails), r[0]);

  // ---- Pick lead
  const cOut = lane(b2b, 'outreach');
  const rows = [
    { row_number: 2, Company: 'Low', Score: 5, Status: 'New' },
    { row_number: 3, Company: 'Best', Score: 9, Status: '' },
    { row_number: 4, Company: 'Done', Score: 12, Status: 'Sent', Sent_on: '2000-01-01' },
    { row_number: 5, Company: 'Second', Score: 9, Status: 'New' },
    { row_number: 6, Company: 'Disc', Score: 11, Status: 'Discarded' },
  ].map(J);
  r = await run('Pick lead', { nodes: { 'Config (outreach)': cfgNode(cOut) }, input: rows });
  check('Pick lead: highest score, oldest row on ties, skips Sent/Discarded/below min', r.length === 1 && r[0].json.company === 'Best' && r[0].json.row_number === 3, r);
  const capped = rows.concat([J({ row_number: 7, Company: 'X', Score: 8, Status: 'Sent', Sent_on: iso(today) }), J({ row_number: 8, Company: 'Y', Score: 8, Status: 'Sent', Sent_on: iso(today) })]);
  r = await run('Pick lead', { nodes: { 'Config (outreach)': cfgNode(cOut) }, input: capped });
  check('Pick lead: daily cap stops the run', r.length === 0, r);
  const cH = lane(fma, 'outreach');
  r = await run('Pick lead', { nodes: { 'Config (outreach)': cfgNode(cH) }, input: [J({ row_number: 2, Company: 'NoDomain', Status: '' }), J({ row_number: 3, Company: 'HasDomain', Domain: 'x.example', Status: '' })] });
  check('Pick lead (Hunter profile): needs a domain and unscored rows use default_score', r.length === 1 && r[0].json.company === 'HasDomain' && r[0].json.score === 10, r);
  r = await run('Pick lead', { nodes: { 'Config (outreach)': cfgNode(cOut) }, input: [J({})] });
  check('Pick lead: empty sheet returns nothing', r.length === 0, r);

  // ---- Parse Hunter contact
  const lead = { row_number: 3, company: 'HasDomain', domain: 'x.example' };
  const hunter = [
    { value: 'info@x.example', position: 'CEO', confidence: 99 },
    { value: 'ann@x.example', first_name: 'Ann', last_name: 'Lee', position: 'Founder and CEO', confidence: 90, linkedin: 'li/ann' },
    { value: 'bob@x.example', first_name: 'Bob', position: 'Intern', confidence: 95 },
    { value: 'bad@x.example', position: 'CEO', confidence: 90, verification: { status: 'invalid' } },
  ].map(J);
  r = await run('Parse Hunter contact', { nodes: { 'Config (outreach)': cfgNode(cH), 'Pick lead': [J(lead)] }, input: hunter });
  check('Parse Hunter: picks the verified decision maker, ignores generic/intern/invalid', r[0].json.contact_email === 'ann@x.example' && r[0].json.contact_name === 'Ann Lee', r[0].json);
  r = await run('Parse Hunter contact', { nodes: { 'Config (outreach)': cfgNode(cH), 'Pick lead': [J(lead)] }, input: [J({})] });
  check('Parse Hunter: no results gives empty contact', r[0].json.contact_email === '', r[0].json);

  // ---- Check duplicates
  const pool = [
    J({ row_number: 3, Company: 'HasDomain', Domain: 'x.example', Status: 'New' }),
    J({ row_number: 9, Company: 'Other', Domain: 'x.example', Contact_email: 'carl@x.example', Status: 'Sent' }),
    J({ row_number: 10, Company: 'Z', Domain: 'z.example', Contact_email: 'dan@z.example', Status: 'Drafted' }),
  ];
  r = await run('Check duplicates', { nodes: { 'Read leads (outreach)': pool }, input: [J({ row_number: 3, domain: 'x.example', contact_email: 'ann@x.example' })] });
  check('Check duplicates: same company already contacted is blocked', r[0].json.duplicate_blocked === true && r[0].json.contact_found === false, r[0].json);
  r = await run('Check duplicates', { nodes: { 'Read leads (outreach)': pool }, input: [J({ row_number: 11, domain: 'new.example', contact_email: 'dan@z.example' })] });
  check('Check duplicates: same email already drafted is blocked', r[0].json.contact_found === false, r[0].json);
  r = await run('Check duplicates', { nodes: { 'Read leads (outreach)': pool }, input: [J({ row_number: 12, domain: 'new.example', contact_email: 'eve@new.example' })] });
  check('Check duplicates: clean contact passes', r[0].json.contact_found === true, r[0].json);
  r = await run('Check duplicates', { nodes: { 'Read leads (outreach)': pool }, input: [J({ row_number: 12, domain: 'new.example', contact_email: '' })] });
  check('Check duplicates: no email is "not found"', r[0].json.contact_found === false && /No verified/.test(r[0].json.discard_reason), r[0].json);

  // ---- Build prompts + Validate draft
  const base = { row_number: 3, company: 'Acme', contact_name: 'Ann Lee', contact_title: 'Founder', contact_email: 'ann@acme.example', domain: 'acme.example', why: 'Posted a VP of Sales role', role: 'VP of Sales', details: '' };
  r = await run('Build prompts', { nodes: { 'Config (outreach)': cfgNode(cOut) }, input: [J(base)] });
  const em = r[0].json.email_request;
  check('Build prompts: placeholders are filled, signature and context present', !/\{\w+\}/.test(em.messages[0].content) && /Acme/.test(em.messages[0].content) && /Your Company/.test(em.messages[0].content) && em.format === 'json', em.messages[0].content.slice(0, 200));
  const goodBody = 'Hi Ann,\n\nI saw Acme posted a VP of Sales role. A defined sales process means the new hire lands on a real pipeline instead of inheriting chaos, and that is what we help founder-led teams set up.\n\nWould a short 15-minute call this week make sense?\n\nYour Name\nBusiness Development\nYour Company';
  const mkOllama = (o) => [J({ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } })];
  const val = async (cfg, email, li = { message: 'Hi Ann, quick note.' }) => run('Validate draft', {
    nodes: { 'Config (outreach)': cfgNode(cfg), 'Build prompts': [J(Object.assign({}, base, { email_request: {}, linkedin_request: {} }))], 'Ollama: draft email': mkOllama(email), 'Ollama: draft LinkedIn': mkOllama(li) }, input: [] });
  r = await val(cOut, { subject: 'Your VP of Sales search', body: goodBody });
  check('Validate: good email in review mode -> draft, opt-out line added, request objects stripped', r[0].json.valid && r[0].json.action === 'draft' && /not relevant/.test(r[0].json.email_body_html) && !('email_request' in r[0].json), r[0].json);
  const cAuto = JSON.parse(JSON.stringify(cOut)); cAuto.send.mode = 'auto';
  r = await val(cAuto, { subject: 'Your VP of Sales search', body: goodBody });
  check('Validate: auto mode -> send', r[0].json.action === 'send', r[0].json);
  r = await val(cAuto, { subject: 'Hi', body: goodBody.replace('Your Company', 'Someone') });
  check('Validate: missing signature -> flag', r[0].json.action === 'flag' && /signature/.test(r[0].json.review_reasons), r[0].json);
  r = await val(cAuto, { subject: 'Hi', body: goodBody.replace('real pipeline', 'recent growth pipeline') });
  check('Validate: banned filler phrase -> flag', r[0].json.action === 'flag' && /filler/.test(r[0].json.review_reasons), r[0].json);
  r = await val(cAuto, 'this is not json at all');
  check('Validate: invalid JSON -> flag with excerpt', r[0].json.action === 'flag' && r[0].json.model_output_excerpt.length > 0, r[0].json);
  r = await val(cAuto, { subject: 'Hi', body: 'Hi {name}, short. Your Company' });
  check('Validate: placeholder garbage / too short -> flag', r[0].json.action === 'flag', r[0].json);
  r = await val(cAuto, { subject: 'Hola', body: 'Hola Ann, vi que buscan cubrir un rol de ventas. El equipo suele ganar tiempo cuando ordena el proceso comercial antes de contratar, y ese es nuestro trabajo diario con fundadores. ¿Tiene sentido una llamada corta esta semana? Saludos, Your Name, Your Company' });
  check('Validate: Spanish text in an English profile -> flag', r[0].json.action === 'flag' && /English/.test(r[0].json.review_reasons), r[0].json);

  // ---- Match replies
  const cRep = lane(b2b, 'replies');
  const sheet = [J({ row_number: 4, Company: 'Acme', Domain: 'acme.example', Contact_email: 'ann@acme.example', Status: 'Sent', Interest: '' }),
                 J({ row_number: 5, Company: 'Beta', Domain: 'beta.example', Contact_email: 'bo@beta.example', Status: 'Replied', Interest: 'Yes' })];
  const mails = [
    J({ from: { value: [{ address: 'ann@acme.example' }] }, subject: 'Re: hello', text: 'Sounds interesting, can we talk Friday?\n\nOn Mon, Oct 12 you wrote:\n> old', cfg: cRep }),
    J({ from: { value: [{ address: 'colleague@acme.example' }] }, subject: 'Re: hello', text: 'Forwarding to the right person', cfg: cRep }),
    J({ from: { value: [{ address: 'ann@acme.example' }] }, subject: 'Automatic reply: out of office', text: 'I am away', cfg: cRep }),
    J({ from: { value: [{ address: 'you@example.com' }] }, subject: 'mine', text: 'x', cfg: cRep }),
    J({ from: { value: [{ address: 'someone@' + 'gmail' + '.com' }] }, subject: 'random', text: 'x', cfg: cRep }),
    J({ from: { value: [{ address: 'bo@beta.example' }] }, subject: 'again', text: 'x', cfg: cRep }),
  ];
  r = await run('Match replies', { nodes: { 'Config (replies)': mails, 'Read leads (replies)': sheet }, input: sheet });
  check('Match replies: one match for Acme (first real reply), autoreply/own/free-mail/already-classified ignored', r.length === 1 && r[0].json.row_number === 4 && /Friday/.test(r[0].json.reply_text) && !/old/.test(r[0].json.reply_text), r);
  check('Match replies: classification request is a JSON-schema request', r[0].json.ollama_request.format.properties.interested.type === 'boolean' && /Friday/.test(r[0].json.ollama_request.messages[0].content), r[0].json.ollama_request);
  r = await run('Match replies', { nodes: { 'Config (replies)': [mails[1]], 'Read leads (replies)': sheet }, input: sheet });
  check('Match replies: a colleague at the same company domain still matches', r.length === 1 && r[0].json.row_number === 4, r);

  // ---- Parse interest
  const prevs = [J({ row_number: 4, company: 'Acme', reply_text: 'yes' }), J({ row_number: 5, company: 'Beta', reply_text: 'no' }), J({ row_number: 6, company: 'Gamma', reply_text: '??' })];
  r = await run('Parse interest', { nodes: { 'Match replies': prevs }, input: [J({ message: { content: '{"interested":true,"reason":"asks for a call"}' } }), J({ message: { content: '{"interested":false,"reason":"unsubscribe"}' } }), J({ error: 'timeout' })] });
  check('Parse interest: Yes / No / Unclear (model failure never guesses)', r[0].json.interest === 'Yes' && r[1].json.interest === 'No' && r[2].json.interest === 'Unclear' && r[2].json.row_number === 6, r.map((x) => x.json));

  // ---- Apollo guard: a lead with no contact must flow to "not found", never to a random person
  r = await run('Check duplicates', { nodes: { 'Read leads (outreach)': pool }, input: [J({ row_number: 12, domain: 'new.example', company: 'Nobody Inc', _org_id: '' })] });
  check('Check duplicates: lead with no organization/person has no contact (discarded, not emailed)', r[0].json.contact_found === false, r[0].json);

  // ---- Pick follow-up
  const cF = lane(b2b, 'followup');
  const bizAgo = (n) => { let d = today; let c = 0; while (c < n) { d = d.minus({ days: 1 }); if (d.weekday <= 5) c++; } return iso(d); };
  const fr = [
    J({ row_number: 2, Company: 'Fresh', Status: 'Sent', Sent_on: iso(today), Contact_email: 'a@a.example' }),
    J({ row_number: 3, Company: 'Replied', Status: 'Replied', Sent_on: bizAgo(5), Contact_email: 'b@b.example', Reply_text: 'hi' }),
    J({ row_number: 4, Company: 'Due', Status: 'Sent', Sent_on: bizAgo(4), Contact_email: 'c@c.example', Contact_name: 'Cy', Why: 'because' }),
    J({ row_number: 5, Company: 'Done', Status: 'Sent', Sent_on: bizAgo(6), Contact_email: 'd@d.example', Followup_on: iso(today) }),
  ];
  r = await run('Pick follow-up', { nodes: { 'Config (follow-up)': cfgNode(cF) }, input: fr });
  check('Pick follow-up: only the lead contacted 3+ business days ago without reply/follow-up', r.length === 1 && r[0].json.company === 'Due' && /Due|Cy/.test(r[0].json.followup_request.messages[0].content), r);
  r = await run('Parse follow-up', { nodes: { 'Pick follow-up': [J({ row_number: 4, company: 'Due', contact_email: 'c@c.example', followup_request: {} })] }, input: [J({ message: { content: '{"subject":"Re: hello","body":"Line1\\nLine2"}' } })] });
  check('Parse follow-up: HTML body and request stripped', r[0].json.followup_body === 'Line1<br>Line2' && !('followup_request' in r[0].json), r[0].json);
  r = await run('Parse follow-up', { nodes: { 'Pick follow-up': [J({ row_number: 4, company: 'Due', contact_email: 'c@c.example' })] }, input: [J({ error: 'x' })] });
  check('Parse follow-up: model failure still yields a usable placeholder draft', /by hand/.test(r[0].json.followup_body), r[0].json);

  // ---- Discovery
  const cD = lane(b2b, 'discovery'), cDf = lane(fma, 'discovery');
  r = await run('Build Adzuna queries', { nodes: { 'Config (discovery)': cfgNode(cD) } });
  check('Build Adzuna queries: one item per configured query', r.length === cD.sources.adzuna.queries.length && r[0].json.what, r.length);
  r = await run('Build Adzuna queries', { nodes: { 'Config (discovery)': cfgNode(cDf) } });
  check('Build Adzuna queries: disabled source yields nothing', r.length === 0, r);
  r = await run('Build Apollo queries', { nodes: { 'Config (discovery)': cfgNode(cD) } });
  check('Build Apollo queries: bodies built from config (titles expanded, funding range)', r.length === 4 && r[0].json.body.q_organization_job_titles.includes('vp of sales') && r[1].json.body.latest_funding_date_range && r[0].json.body.organization_locations.length === 3, r[0].json);
  r = await run('Build news queries', { nodes: { 'Config (discovery)': cfgNode(cD) } });
  check('Build news queries: RSS urls', r.length === 2 && /news\.google\.com/.test(r[0].json.url), r);
  const adz = [J({ results: [
    { title: 'VP of Sales', company: { display_name: 'Acme Analytics' }, location: { display_name: 'Austin, TX' }, redirect_url: 'u1', description: 'x', created: '2026-09-01' },
    { title: 'Warehouse Associate', company: { display_name: 'Nope Inc' }, location: { display_name: 'Austin' }, redirect_url: 'u2' },
    { title: 'VP of Sales', company: { display_name: 'Acme Analytics' }, location: { display_name: 'Austin, TX' }, redirect_url: 'u1' } ] })];
  r = await run('Parse Adzuna', { nodes: { 'Config (discovery)': cfgNode(cD) }, input: adz });
  check('Parse Adzuna: keeps sales titles only and dedupes', r.length === 1 && r[0].json.company === 'Acme Analytics' && r[0].json.signals[0] === 'hiring_sales_role', r);
  const news = [J({ title: 'Austin-based Foo Labs raises $4M seed round - TechSite', link: 'l', isoDate: new Date().toISOString() }), J({ title: 'How to hire sales reps', link: 'l2' })];
  r = await run('Parse news signals', { nodes: { 'Config (discovery)': cfgNode(cD) }, input: news });
  check('Parse news signals: extracts company and funding signal', r.length === 1 && r[0].json.company === 'Foo Labs' && r[0].json.signals.includes('recent_funding'), r);

  const existing = [J({ Company: 'Known Co', Domain: 'known.example' })];
  const cands = [
    J({ company: 'Acme Analytics', position: 'VP of Sales', location: 'Austin, TX', dominio: 'acme.example', source: 'adzuna', signals: ['hiring_sales_role', 'stale_vacancy'], empleados: 12, revenue: '2M', description: 'saas' }),
    J({ company: 'Acme Analytics Inc', position: '', location: '', dominio: 'acme.example', source: 'apollo', signals: ['recent_funding'], empleados: 12, description: 'more' }),
    J({ company: 'Known Co', dominio: 'known.example', source: 'apollo', signals: ['recent_funding'] }),
    J({ company: 'Staffing Heroes', dominio: 'sh.example', source: 'apollo', signals: ['hiring_sales_role'] }),
    J({ company: 'Salesforce', dominio: 'salesforce.com', source: 'apollo', signals: ['hiring_sales_role'] }),
    J({ company: 'BigCo', dominio: 'big.example', source: 'apollo', signals: ['hiring_sales_role'], empleados: 800 }),
    J({ company: 'Weak LLC', dominio: 'weak.example', source: 'apollo', signals: [], empleados: 40 }),
  ];
  const sdata = {};
  r = await run('Dedupe and pre-score', { nodes: { 'Config (discovery)': cfgNode(cD), 'Get existing leads': existing }, input: cands, staticData: sdata });
  const names = r.map((x) => x.json.company);
  check('Dedupe: merges same domain, drops known/blocked/big/oversized', names.length === 2 && names[0] === 'Acme Analytics' && names.includes('Weak LLC'), names);
  check('Dedupe: merged signals and matrix computed', r[0].json.signals.includes('recent_funding') && r[0].json.signals.includes('hiring_sales_role') && r[0].json.matrix >= 6 && /founder:/.test(r[0].json.matrix_detail), r[0].json);
  r = await run('Dedupe and pre-score', { nodes: { 'Config (discovery)': cfgNode(cD), 'Get existing leads': existing }, input: cands, staticData: sdata });
  check('Dedupe: same candidates with no new signals are skipped on the next run', r.length === 0, r.map((x) => x.json.company));
  r = await run('Build score prompts', { nodes: { 'Config (discovery)': cfgNode(cD) }, input: [J({ company: 'Acme', source: 'apollo', signals: ['hiring_sales_role'], matrix: 8, matrix_detail: 'founder:1', description: 'd' })] });
  check('Build score prompts: schema + rubric in system message', r[0].json.ollama_request.format.required.includes('score') && /ICP/.test(r[0].json.ollama_request.messages[0].content), r[0].json.ollama_request.model);
  const prompts = [J({ company: 'A', matrix: 8, dominio: 'a.example', source: 'apollo', signals: ['x'] }), J({ company: 'B', matrix: 8, source: 'adzuna', signals: [] }), J({ company: 'C', matrix: 7, source: 'apollo', signals: [] }), J({ company: 'D', matrix: 9, source: 'apollo', signals: [] })];
  r = await run('Parse score', { nodes: { 'Config (discovery)': cfgNode(cD), 'Build score prompts': prompts }, input: [
    J({ message: { content: '{"score":10,"why":"VP role posted"}' } }), J({ message: { content: '{"score":3,"why":"has RevOps already"}' } }), J({ message: { content: '{"score":8,"why":"ok"}' } }), J({ error: 'down' })] });
  const by = Object.fromEntries(r.map((x) => [x.json.Company, x.json]));
  check('Parse score: blends LLM+matrix, hard rule (<=4) wins and drops, model failure falls back to matrix', by.A.Score === 9 && !by.B && by.C.Score === 8 && by.D.Score === 9 && by.D.LLM_score === '' && by.A.Status === 'New', r.map((x) => [x.json.Company, x.json.Score]));

  // ---- Report + intake
  r = await run('Build report', { nodes: { 'Config (report)': cfgNode(lane(b2b, 'report')) }, input: [
    J({ Company: 'A', Status: 'Sent', Sent_on: '2026-10-01', Source: 'apollo', Signals: 'recent_funding', Vertical: 'SaaS', Score: 9, Added_on: iso(today), Reply_text: 'hi', Interest: 'Yes' }),
    J({ Company: 'B', Status: 'New', Source: 'adzuna', Signals: '', Vertical: '', Score: 7, Added_on: '2020-01-01' })] });
  check('Build report: html with funnel numbers', /Leads in the pool: <b>2<\/b>/.test(r[0].json.html) && /Interested: <b>1<\/b>/.test(r[0].json.html) && r[0].json.subject === 'Lead gen weekly report', r[0].json.html.slice(0, 200));
  r = await run('Parse intake lead', { input: [J({ body: { company: ' Delta Co ', domain: 'https://www.Delta.example/about', signals: ['a', 'b'], score: '8' } })] });
  check('Parse intake lead: normalises domain, signals and score', r[0].json.domain === 'delta.example' && r[0].json.signals === 'a|b' && r[0].json.score === 8, r[0].json);
  r = await run('Parse intake lead', { input: [J({ body: { domain: 'x.example' } })] });
  check('Parse intake lead: missing company is invalid', r[0].json.invalid === true, r);
  r = await run('Check intake duplicate', { nodes: { 'Parse intake lead': [J({ invalid: false, company: 'Delta Co.', domain: 'delta.example' })] }, input: [J({ Company: 'Delta Company', Domain: 'delta.example' })] });
  check('Check intake duplicate: detects existing company', r[0].json.skip === true, r[0].json);
  r = await run('Check intake duplicate', { nodes: { 'Parse intake lead': [J({ invalid: false, company: 'Newco', domain: 'newco.example' })] }, input: [J({ Company: 'Delta Company', Domain: 'delta.example' })] });
  check('Check intake duplicate: new lead passes', r[0].json.skip === false, r[0].json);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL LEAD-GEN CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
