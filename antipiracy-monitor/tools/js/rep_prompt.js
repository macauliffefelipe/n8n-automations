// Entrada: una fila por cliente con `datos` (JSON del SQL). Pide a Ollama UNA frase humana sobre cifras reales.
const MODELO = 'qwen2.5:14b';   // EDITAR: el mismo modelo del triage u otro de tu Ollama
const SYS = 'Escribís una o dos frases en portugués brasileño, cálidas y profesionales, que resumen la semana de antipiratería de una autora. '
  + 'Usá SOLO las cifras que te paso, no inventes datos, sin emojis. Si no hubo novedades, decilo con tranquilidad. '
  + 'Respondé SOLO un JSON: {"frase":"..."}';

return $input.all().map((it, i) => {
  const d = it.json.datos || {};
  const hechos = {
    novos_links: d.novos, notificacoes_enviadas: (d.notificacoes || []).length,
    removidos_na_semana: d.removidos_semana, dias_medios_ate_remocao: d.dias_medios,
    total_encontrado: d.total_encontrado, total_removido: d.total_removido,
    casos_persistentes: (d.persistentes || []).length,
  };
  return {
    json: {
      datos: d,
      ollama_body: {
        model: MODELO, stream: false, format: 'json', options: { temperature: 0.3, num_ctx: 2048 },
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(hechos) }],
      },
    },
    pairedItem: { item: i },
  };
});
