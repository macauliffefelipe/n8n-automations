// @include common.js
// Entrada: candidatos nuevos recién insertados. Un solo mensaje con los 15 más grandes.
const filas = $input.all().map((i) => i.json);
if (!filas.length) return [];
const chat = filas[0].chat_id;
if (!chat) return [];
filas.sort((a, b) => (b.miembros || 0) - (a.miembros || 0));
const lineas = filas.slice(0, 15).map((f) => `• @${esc(f.username)} · ${esc(f.titulo)} · ${f.miembros == null ? '?' : f.miembros} miembros`);
return [{
  json: {
    chat_id: String(chat),
    texto: `<b>🛰️ ${filas.length} canal(es) nuevo(s) para evaluar</b>\nUnite a mano a los que valgan la pena y marcá estado='unido' en grupos_candidatos.\n\n${lineas.join('\n')}`.slice(0, 3900),
  },
}];
