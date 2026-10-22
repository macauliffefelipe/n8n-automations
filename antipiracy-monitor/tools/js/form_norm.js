// @include common.js
// Denuncia de una lectora: normaliza la URL y la deja en la cola de revisión.
const j = $input.first().json;
const url = normUrl(j['Link']);
if (!url) return [];
return [{ json: {
  titulo: String(j['Titulo do livro'] || '').trim(),
  url,
  plataforma: platformOf(hostOf(url)),
  nota: String(j['Observacoes'] || '').slice(0, 500),
} }];
