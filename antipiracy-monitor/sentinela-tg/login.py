"""Login interactivo de la cuenta sentinela. Se corre UNA vez:

    docker compose run --rm sentinela python login.py

Te pide el teléfono del chip dedicado, el código que llega por Telegram y la contraseña 2FA si la tiene.
La sesión queda en /data/sentinela.session (volumen ./data). Hacé backup de ese archivo.
"""
import os

from telethon.sync import TelegramClient

api_id = int(os.environ["TG_API_ID"])
api_hash = os.environ["TG_API_HASH"]
session = os.environ.get("TG_SESSION", "/data/sentinela")

with TelegramClient(session, api_id, api_hash) as c:
    me = c.get_me()
    print(f"Sesión OK como: {me.first_name} (id {me.id})")
