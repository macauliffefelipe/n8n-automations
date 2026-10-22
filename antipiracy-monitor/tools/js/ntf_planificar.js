// Entrada: hallazgos confirmados sin notificación en su nivel. Salida: 1 item con las notificaciones a insertar.
// Email = se arma y espera tu botón (o sale solo si config.auto_email = true y dry_run = false).
// Google, Cloudflare, marketplaces y sitios con formulario propio = bloque listo para pegar, envío SIEMPRE humano.
const cfg = $('Config').first().json.cfg || {};
const auto = cfg.auto_email === 'true';
const ag = {
  nome: cfg.agente_nome || '[NOME DO AGENTE]',
  email: cfg.agente_email || '[EMAIL DO AGENTE]',
  endereco: cfg.agente_endereco || '[ENDEREÇO DO AGENTE]',
};
const items = $input.all().map((i) => i.json);
const rows = [];

const uniq = (a) => [...new Set(a.filter(Boolean))];
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const groupBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.values()];
};
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '(data da primeira notificação)');
const MANUAL_WEB = ['scribd', 'docero', 'passeidireto'];
const NO_WEB = ['telegram', 'mercadolivre', 'amazon'];

const obras = (g) => uniq(g.map((x) => x.obra_titulo)).map((t) => `- ${t}`).join('\n');
const oficiais = (g) => uniq(g.flatMap((x) => x.urls_oficiais || [])).map((u) => `- ${u}`).join('\n') || '- (não informado)';
const multi = (g) => uniq(g.map((x) => x.obra_titulo)).length > 1;
const urls = (g) => g.map((x) => `- ${x.url}${multi(g) ? `  (obra: ${x.obra_titulo})` : ''}`).join('\n');
const titular = (g) => g[0].nome_autoral;
const firma = `${ag.nome}\n${ag.email}\n${ag.endereco}\nAgente autorizado de ${'%TITULAR%'}`;

function avisoSeguimiento(g) {
  if (!(g[0].nivel_escalado > 0)) return '';
  return `\nESTA É UMA NOTIFICAÇÃO DE ACOMPANHAMENTO. A primeira notificação foi enviada em ${dia(g[0].notificado_em)} e o conteúdo continua acessível. Solicitamos ação imediata.\n`;
}

function avisoPt(g, destino) {
  return `Prezados responsáveis por ${destino},
${avisoSeguimiento(g)}
Eu, ${ag.nome}, na qualidade de agente autorizado(a) de ${titular(g)}, titular dos direitos autorais das obras abaixo, notifico que o seu serviço hospeda ou disponibiliza, sem autorização, cópias das seguintes obras:

${obras(g)}

URLs que contêm o material infrator:
${urls(g)}

Edição(ões) oficial(is) autorizada(s):
${oficiais(g)}

Solicito a remoção imediata do conteúdo acima, ou o bloqueio do acesso a ele.

Declaro, de boa-fé, que o uso descrito não é autorizado pelo titular dos direitos autorais, por seu agente ou pela lei. Declaro que as informações desta notificação são exatas e, sob as penas da lei, que estou autorizado(a) a agir em nome do titular dos direitos autorais.

Atenciosamente,
${firma.replace('%TITULAR%', titular(g))}`;
}

function avisoEn(g) {
  return `To the Telegram DMCA team,
${g[0].nivel_escalado > 0 ? `\nTHIS IS A FOLLOW-UP. Our first notice was sent on ${dia(g[0].notificado_em)} and the content is still available.\n` : ''}
I am ${ag.nome}, authorized agent of ${titular(g)}, the copyright owner of the book(s) listed below. Unauthorized copies are being distributed through the following Telegram messages.

Works:
${obras(g)}

Official edition(s):
${oficiais(g)}

Infringing messages:
${urls(g)}

Please remove the infringing content and, where applicable, restrict the channels distributing it.

I have a good faith belief that the use described above is not authorized by the copyright owner, its agent, or the law. The information in this notice is accurate and, under penalty of perjury, I am authorized to act on behalf of the copyright owner.

Sincerely,
${firma.replace('%TITULAR%', titular(g)).replace('Agente autorizado de', 'Authorized agent of')}`;
}

function bloqueGoogle(g) {
  return `== PARA PEGAR EN EL FORMULARIO DE GOOGLE ==
Formulario: https://reportcontent.google.com/forms/dmca_search
Titular de los derechos: ${titular(g)}
Agente que presenta: ${ag.nome} <${ag.email}>
Dirección: ${ag.endereco}

Obra(s) protegida(s):
${obras(g)}

Edición(es) oficial(es):
${oficiais(g)}

URLs que infringen (${g.length}):
${urls(g)}

RECORDATORIO: el formulario es una declaración bajo pena de perjurio. Abrí cada URL y confirmá que contiene la obra antes de enviar.`;
}

function bloqueGenerico(titulo, g, extra) {
  return `== ${titulo} ==
Titular de los derechos: ${titular(g)}
Agente: ${ag.nome} <${ag.email}>
${extra ? extra + '\n' : ''}
Obra(s):
${obras(g)}

Edición(es) oficial(es):
${oficiais(g)}

URLs / publicaciones que infringen (${g.length}):
${urls(g)}
${g[0].nivel_escalado > 0 ? `\nSEGUIMIENTO: primera notificación el ${dia(g[0].notificado_em)}, el contenido sigue en línea.` : ''}
RECORDATORIO: confirmá cada enlace a mano antes de enviar. Es una declaración bajo pena de perjurio.`;
}

function push(g, canal, destinatario, asunto, corpo, manual) {
  rows.push({
    cliente_id: g[0].cliente_id,
    canal,
    nivel: g[0].nivel_escalado,
    achado_ids: g.map((x) => x.id),
    destinatario,
    asunto,
    corpo,
    status: manual ? 'pendente_manual' : (auto ? 'aprobada' : 'pendente_aprobacion'),
  });
}

for (const nivel of [0, 1]) {
  const lote = items.filter((a) => (nivel === 0 ? a.nivel_escalado === 0 : a.nivel_escalado >= 1));
  const web = lote.filter((a) => !NO_WEB.includes(a.plataforma));

  // --- Google Search (solo nivel 0): lotes de 20 URLs por cliente
  if (nivel === 0) {
    for (const porCliente of groupBy(web, (a) => a.cliente_id)) {
      for (const g of chunk(porCliente, 20)) {
        push(g, 'google_search', 'Formulário Google (remoção por direitos autorais)',
          `Google · ${titular(g)} · ${g.length} URL(s)`, bloqueGoogle(g), true);
      }
    }
  }

  // --- Sitios: email al host / registrador, formulario manual si hay Cloudflare o sitio con formulario propio
  for (const g of groupBy(web, (a) => `${a.cliente_id}|${a.dominio}`)) {
    const a0 = g[0];
    const dominio = a0.dominio || 'o site';
    if (MANUAL_WEB.includes(a0.plataforma)) {
      push(g, 'scribd', `Formulário de copyright de ${dominio}`,
        `${dominio} · ${titular(g)} · ${g.length} URL(s)`,
        bloqueGenerico(`FORMULÁRIO DE COPYRIGHT DE ${dominio.toUpperCase()}`, g,
          'Dónde: formulario "Copyright / DMCA" del pie de página del sitio.'), true);
      continue;
    }
    if (a0.cloudflare) {
      push(g, 'cloudflare', 'Formulário de abuso da Cloudflare',
        `Cloudflare · ${dominio} · ${g.length} URL(s)`,
        bloqueGenerico('FORMULARIO DE ABUSO DE CLOUDFLARE (copyright)', g,
          `Formulario: https://abuse.cloudflare.com/\nSitio: ${dominio} (detrás de Cloudflare; ellos reenvían al host real).`), true);
    }
    const asunto = nivel === 0
      ? `Notificação de violação de direitos autorais: ${dominio}`
      : `ACOMPANHAMENTO: notificação de violação de direitos autorais: ${dominio}`;
    if (nivel === 0) {
      const dest = uniq([a0.cloudflare ? null : a0.abuse_host_email, `dmca@${dominio}`, `abuse@${dominio}`]);
      push(g, 'host_abuse', dest.join(', '), asunto, avisoPt(g, dominio), false);
    } else if (a0.abuse_registrar_email) {
      push(g, 'host_abuse', a0.abuse_registrar_email, asunto, avisoPt(g, `${dominio} (registrador)`), false);
    } else if (!a0.cloudflare) {
      push(g, 'host_abuse', `(sin email del registrador de ${dominio}: buscarlo con whois)`, asunto,
        bloqueGenerico('ESCALADO MANUAL AL REGISTRADOR', g, `Sitio: ${dominio}`), true);
    }
  }

  // --- Telegram: email a dmca@telegram.org
  for (const g of groupBy(lote.filter((a) => a.plataforma === 'telegram'), (a) => a.cliente_id)) {
    for (const parte of chunk(g, 40)) {
      push(parte, 'telegram', 'dmca@telegram.org',
        `${nivel === 0 ? '' : 'Follow-up: '}Copyright infringement notice: ${titular(parte)}`, avisoEn(parte), false);
    }
  }

  // --- Marketplaces: bloque manual
  for (const g of groupBy(lote.filter((a) => a.plataforma === 'mercadolivre'), (a) => a.cliente_id)) {
    push(g, 'mercado_livre', 'Programa de Proteção à Propriedade Intelectual (Mercado Livre)',
      `Mercado Livre · ${titular(g)} · ${g.length} anúncio(s)`,
      bloqueGenerico('DENUNCIA EN MERCADO LIVRE (PPI)', g, 'Anuncios que venden copias no autorizadas.'), true);
  }
  for (const g of groupBy(lote.filter((a) => a.plataforma === 'amazon'), (a) => a.cliente_id)) {
    push(g, 'amazon', 'Amazon · Report Infringement',
      `Amazon · ${titular(g)} · ${g.length} listing(s)`,
      bloqueGenerico('DENUNCIA EN AMAZON (Report Infringement)', g, 'Cuenta de rights owner. Comparar contra el ASIN oficial.'), true);
  }
}

if (!rows.length) return [];
return [{ json: { rows } }];
