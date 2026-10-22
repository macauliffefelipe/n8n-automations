#!/usr/bin/env bash
# Crea (o actualiza) las credenciales de Sentinela DENTRO de n8n, con los IDs que usan los workflows.
# Los secretos no pasan por ningún chat: Postgres y API key se leen de .env y el token del bot se pide por teclado.
# Uso, desde la carpeta sentinela:   bash tools/crear_credenciales.sh
# SMTP y DataForSEO se crean con datos de relleno solo si no existen; completalos después en la interfaz de n8n
# (editar la credencial en n8n conserva el ID).
set -euo pipefail
cd "$(dirname "$0")/.."

N8N="${N8N_CONTAINER:-n8n}"
[ -f .env ] || { echo "No encuentro .env. Corré esto parado en la carpeta sentinela."; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$N8N" || { echo "No encuentro el contenedor '$N8N'. Usá N8N_CONTAINER=nombre bash tools/crear_credenciales.sh"; exit 1; }

PGPW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
APIKEY=$(grep '^API_KEY=' .env | cut -d= -f2-)
[ -n "$PGPW" ] && [ -n "$APIKEY" ] || { echo "Faltan POSTGRES_PASSWORD o API_KEY en .env"; exit 1; }

printf "Token del bot de Telegram (no se muestra al escribir): "
read -rs TGTOKEN
echo
[ -n "$TGTOKEN" ] || { echo "Token vacío."; exit 1; }

EXIST=$(docker exec "$N8N" n8n export:credentials --all 2>/dev/null | grep -oE '"id": ?"[^"]*"' || true)
HAS_SMTP=0; HAS_DFS=0
echo "$EXIST" | grep -q 'SntSmtp_001' && HAS_SMTP=1
echo "$EXIST" | grep -q 'SntDataForSEO_001' && HAS_DFS=1

docker exec -i \
  -e PGPW="$PGPW" -e APIKEY="$APIKEY" -e TGTOKEN="$TGTOKEN" -e HAS_SMTP="$HAS_SMTP" -e HAS_DFS="$HAS_DFS" \
  "$N8N" node -e '
const fs = require("fs"), e = process.env;
const c = [
  { id: "SntPostgres_001", name: "Sentinela Postgres", type: "postgres",
    data: { host: "postgres", port: 5432, database: "sentinela", user: "sentinela", password: e.PGPW,
            ssl: "disable", allowUnauthorizedCerts: false, maxConnections: 100 } },
  { id: "SntApiKey_001", name: "Sentinela API Key", type: "httpHeaderAuth",
    data: { name: "X-API-Key", value: e.APIKEY } },
  { id: "SntTelegram_001", name: "Sentinela Bot", type: "telegramApi",
    data: { accessToken: e.TGTOKEN, baseUrl: "https://api.telegram.org" } },
];
if (e.HAS_SMTP !== "1") c.push({ id: "SntSmtp_001", name: "SMTP Sentinela", type: "smtp",
  data: { host: "smtp.example.com", port: 587, user: "completar", password: "completar", secure: false, disableStartTls: false, hostName: "" } });
if (e.HAS_DFS !== "1") c.push({ id: "SntDataForSEO_001", name: "DataForSEO", type: "httpBasicAuth",
  data: { user: "completar", password: "completar" } });
fs.writeFileSync("/tmp/sentinela-cred.json", JSON.stringify(c));
'

docker exec "$N8N" n8n import:credentials --input=/tmp/sentinela-cred.json
docker exec "$N8N" rm -f /tmp/sentinela-cred.json

echo
echo "Listo. Recargá n8n en el navegador (si no ves las credenciales, reiniciá con: docker restart $N8N)."
[ "$HAS_SMTP" = "1" ] || echo "Pendiente: completar 'SMTP Sentinela' con tu buzón real."
[ "$HAS_DFS" = "1" ] || echo "Pendiente: completar 'DataForSEO' con tu login y password de DataForSEO."
