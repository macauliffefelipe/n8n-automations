// Entrada: salida de "Decidir". Si Ollama no respondió, avisa por Telegram como máximo una vez cada 6 horas
// (el triage corre cada 30 min y los hallazgos quedan en 'novo' hasta que vuelva).
const cfg = $('Config').first().json.cfg || {};
const chat = String(cfg.telegram_admin_chat_id || '').trim();
const items = $input.all().map((i) => i.json);
const fallidos = items.filter((x) => x.sin_llm).length;
if (!chat || !fallidos) return [];
const st = $getWorkflowStaticData('global');
const ahora = Date.now();
if (st.ultimo_aviso_llm && ahora - st.ultimo_aviso_llm < 6 * 3600 * 1000) return [];
st.ultimo_aviso_llm = ahora;
return [{
  json: {
    chat_id: chat,
    texto: `⚠️ <b>Triage</b>: Ollama no respondió para ${fallidos} de ${items.length} hallazgos. `
      + 'Quedan en cola (novo) y se reintentan solos. Revisá que la Mac mini esté despierta y el túnel/Tailscale arriba. '
      + '(Este aviso se repite como máximo cada 6 h.)',
  },
}];
