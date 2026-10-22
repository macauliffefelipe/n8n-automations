// Entrada: Error Trigger + fila con el chat id del admin.
const e = $('Error Trigger').first().json || {};
const chat = String(($input.first().json || {}).valor || '').trim();
if (!chat) return [];
const wf = (e.workflow && e.workflow.name) || 'workflow';
const nodo = (e.execution && e.execution.lastNodeExecuted) || '?';
const msg = (e.execution && e.execution.error && e.execution.error.message) || 'sin detalle';
return [{ json: { chat_id: chat, texto: `❌ Falló "${wf}" en el nodo "${nodo}":\n${String(msg).slice(0, 600)}` } }];
