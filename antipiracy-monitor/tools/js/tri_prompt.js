// Entrada (Merge por posición): hallazgo + respuesta de /pagina. Arma el body para Ollama.
const MODELO = 'qwen2.5:14b';   // EDITAR: cualquier modelo que tengas en Ollama (ollama list)
const SYS = [
  'Sos un analista antipiratería de libros. Decidís si una URL ofrece, aloja o vende copias NO autorizadas de un libro.',
  'Respondé SOLO con un objeto JSON, sin texto extra, con estas claves:',
  '"infractor" (true o false), "confianza" (número entre 0 y 1), "tipo" (uno de: pdf_direto, agregador, grupo_telegram, listing, otro), "motivo" (una frase corta en español).',
  'Reglas:',
  '- infractor=true solo si el resultado permite leer o descargar el libro completo, o vende una copia que no es la edición oficial.',
  '- Un archivo PDF/EPUB/MOBI con el título del libro es infractor=true.',
  '- infractor=false si es una reseña, blog, noticia, ficha de una librería oficial, red social de lectores, o si solo menciona el título.',
  '- Si dudás, usá confianza menor a 0.6.',
].join('\n');

return $input.all().map((it, i) => {
  const j = it.json;
  const datos = {
    libro: j.obra_titulo,
    autora: j.nome_autoral,
    url: j.url,
    plataforma: j.plataforma,
    texto_del_resultado: j.snippet || null,
    tipo_de_contenido: j.content_type || null,
    tamano_bytes: j.bytes || null,
    http_status: j.status || null,
    titulo_pagina: j.titulo || null,
    texto_pagina: String(j.texto || '').slice(0, 2000),
  };
  const body = {
    model: MODELO,
    stream: false,
    format: 'json',
    options: { temperature: 0, num_ctx: 4096 },
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(datos) }],
  };
  return {
    json: {
      id: j.id, url: j.url, es_frase: j.es_frase, plataforma: j.plataforma, motor: j.motor,
      content_type: j.content_type || null, ollama_body: body,
    },
    pairedItem: { item: i },
  };
});
