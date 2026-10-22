// Entrada (Merge por posición): hallazgo a verificar + respuesta de /chequear. Decide removido / escalar / persistente.
const REMOVIDO = /(removed (due to|for|because of|at the request)|has been (removed|taken down)|taken down (due to|for)|removido por (viola[cç][aã]o|direitos)|(arquivo|conte[uú]do|livro|documento) (foi )?(removido|exclu[ií]do|indispon[ií]vel)|file (not found|has been deleted)|n[aã]o est[aá] mais dispon[ií]vel)/i;

return $input.all().map((it, i) => {
  const j = it.json;
  let ainda = null;       // true = sigue arriba, false = removido, null = inconcluso
  let nota = '';
  let httpStatus = j.status == null ? '' : String(j.status);

  if (j.tipo === 'telegram') {
    if (j.estado === 'removido') { ainda = false; nota = j.nota || 'removido en Telegram'; }
    else if (j.estado === 'activo') { ainda = true; nota = j.nota || ''; }
    else { ainda = null; nota = j.nota || 'indeterminado'; }
  } else if (j.error || j.status == null) {
    const nulos = Number(j.nulos_previos || 0);
    if (nulos >= 2) { ainda = false; nota = `sitio sin respuesta en 3 chequeos seguidos (${typeof j.error === 'string' ? j.error : 'error'})`; }
    else { ainda = null; nota = `sin respuesta: ${typeof j.error === 'string' ? j.error : JSON.stringify(j.error || 'error')}`; }
  } else if (j.status === 404 || j.status === 410) {
    ainda = false; nota = `HTTP ${j.status}`;
  } else if (j.status >= 500 || [401, 403, 429].includes(j.status)) {
    // 401/403/429: casi siempre Cloudflare o un anti-bot frente a nuestro cliente, no prueba de que siga arriba.
    ainda = null; nota = `HTTP ${j.status} (inconcluso: bloqueo o error del sitio)`;
  } else if (REMOVIDO.test(String(j.texto || '')) || REMOVIDO.test(String(j.titulo || ''))) {
    ainda = false; nota = 'la página informa que el contenido fue removido';
  } else {
    ainda = true; nota = `HTTP ${j.status}`;
  }

  const dias = Number(j.dias || 0);
  const nivel = Number(j.nivel_escalado || 0);
  let accion = 'seguir';
  if (ainda === false) accion = 'removido';
  else if (ainda === true && dias >= 30) accion = 'persistente';
  else if (ainda === true && dias >= 14 && nivel === 0) accion = 'escalar';

  return {
    json: {
      achado_id: j.achado_id,
      http_status: httpStatus,
      ainda_no_ar: ainda === null ? '' : String(ainda),
      nota: String(nota).slice(0, 300),
      accion,
    },
    pairedItem: { item: i },
  };
});
