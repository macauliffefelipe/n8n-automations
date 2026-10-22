const cfg = $('Config').first().json.cfg || {};
const terminos = String(cfg.telegram_terminos || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!terminos.length) return [];
return [{ json: { terminos, limite: 15 } }];
