const H = (typeof $helpers !== 'undefined') ? $helpers : this.helpers;

function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|ved$|usg$|sa$)/i.test(k)) x.searchParams.delete(k);
    }
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, '');
    let s = x.toString();
    if (x.pathname.length > 1 && !x.search && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch (e) { return null; }
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
}

function platformOf(host) {
  const h = host || '';
  const is = (d) => h === d || h.endsWith('.' + d);
  if (is('t.me') || is('telegram.me')) return 'telegram';
  if (is('scribd.com')) return 'scribd';
  if (is('docero.com.br') || is('docero.net')) return 'docero';
  if (is('passeidireto.com')) return 'passeidireto';
  if (is('4shared.com')) return '4shared';
  if (is('mediafire.com')) return 'mediafire';
  if (is('mercadolivre.com.br') || is('mercadolibre.com')) return 'mercadolivre';
  if (/(^|\.)amazon\./.test(h)) return 'amazon';
  if (is('drive.google.com') || is('docs.google.com')) return 'drive';
  return 'web';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
