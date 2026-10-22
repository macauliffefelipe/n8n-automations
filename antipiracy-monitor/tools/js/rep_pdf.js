// Entrada: PDF de Gotenberg (binario `pdf`). Recupera los datos del cliente desde "Armar HTML" y nombra el archivo.
return $input.all().map((it, i) => {
  const base = $('Armar HTML').itemMatching(i).json;
  const nombre = String(base.cliente || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const bin = it.binary.pdf;
  bin.fileName = `Relatorio-Sentinela-${nombre}-${base.hasta || ''}.pdf`.replace(/-\.pdf$/, '.pdf');
  bin.mimeType = 'application/pdf';
  return { json: { ...base }, binary: { pdf: bin }, pairedItem: { item: i } };
});
