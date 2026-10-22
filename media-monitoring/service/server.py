#!/usr/bin/env python3
"""Servicio local de informes de monitoreo.
  POST /monitoreo   JSON del informe -> pptx formato "Monitoreo de medios"
  POST /generate    JSON del informe -> pptx con la plantilla AM/PM
  POST /notas       {"notas":[...]} guarda notas recolectadas (dedup por "clave")
  GET  /notas?desde=ms&hasta=ms[&tardias=1][&corte=fecha|corte]   notas de la ventana [desde, hasta) + indexadas tarde, sin las ya usadas en otros cortes
                    ("usadas_notas": las usadas cerca de la ventana, para detectar la misma nota traida por otra fuente)
  POST /cortes      guarda el resumen de un corte
  GET  /cortes/ultimo?antes=ms     corte anterior en el tiempo (reprocesar un corte lo reemplaza)
  POST /feedback   {"clave","corte","tipo"} correccion hecha desde el mail de revision
  GET  /calidad    falsos positivos, falsos negativos y sentiment, solo sobre cortes marcados como revisados (ultimos 30 dias),
                   y los archivos .corrupto que haya que revisar
  GET  /recoleccion?desde&hasta   corridas de recoleccion y hueco maximo en la ventana
  GET  /health     (sin token)
Uso: python3 server.py plantilla.pptx [puerto]
Token: variable INFORME_TOKEN o archivo token.txt al lado de este script (header X-Token). Sin token, no pide autenticacion."""
import json, os, sys, tempfile, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import gen_informe, gen_monitoreo

TPL = sys.argv[1] if len(sys.argv) > 1 else "plantilla.pptx"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8787
BASE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get("INFORME_TOKEN")
if not TOKEN and os.path.exists(os.path.join(BASE, "token.txt")):
    TOKEN = open(os.path.join(BASE, "token.txt"), encoding="utf-8").read().strip() or None
FEEDBACK = os.path.join(BASE, "datos_feedback.json")
TIPOS_REL = ("no_relevante", "si_relevante")
TIPOS_SENT = ("positivo", "neutral", "negativo")
TIPO_REVISADO = "revisado"   # "revisé todo este corte": solo esos cortes cuentan para medir la calidad
NOTAS = os.path.join(BASE, "datos_notas.json")
CORTES = os.path.join(BASE, "datos_cortes.json")
RECOLECCION = os.path.join(BASE, "datos_recoleccion.json")
RETENER_DIAS = 7
LOCK = threading.Lock()

class DatosCorruptos(Exception): pass

def leer(path, default):
    if not os.path.exists(path): return default
    try:
        with open(path, encoding="utf-8") as f: return json.load(f)
    except Exception as e:
        # No se devuelve vacio: eso haria que el proximo guardado pise todo el historial.
        destino = path + "." + time.strftime("%Y%m%d-%H%M%S") + ".corrupto"
        os.replace(path, destino)
        raise DatosCorruptos(f"{os.path.basename(path)} estaba corrupto ({e}); se movio a {os.path.basename(destino)}. Revisalo antes de seguir.")

def escribir(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def _json(self, code, obj): self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))
    def _err(self, code, msg, detail=None): self._json(code, {"error": msg, "detalle": detail or []})
    def _auth(self):
        if TOKEN and self.headers.get("X-Token") != TOKEN: self._err(401, "token invalido"); return False
        return True
    def _body(self):
        n = int(self.headers.get("Content-Length", "0")); return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_GET(self):
        try: return self._get()
        except DatosCorruptos as e: return self._err(500, "datos corruptos", [str(e)])

    def do_POST(self):
        try: return self._post()
        except DatosCorruptos as e: return self._err(500, "datos corruptos", [str(e)])

    def _usadas(self, excluir_corte):
        """Claves que ya se consideraron en otros cortes (para no contar una nota dos veces)."""
        usadas = set()
        for c in leer(CORTES, []):
            if f"{c.get('fecha')}|{c.get('corte')}" != excluir_corte: usadas.update(c.get("consideradas", []))
        return usadas

    def _get(self):
        u = urlparse(self.path)
        if u.path == "/health": return self._json(200, {"ok": True})
        if not self._auth(): return
        if u.path == "/notas":
            q = parse_qs(u.query)
            try: desde = int(q.get("desde", ["0"])[0]); hasta = int(q.get("hasta", [str(10**15)])[0])
            except ValueError: return self._err(400, "desde/hasta deben ser milisegundos")
            tardias = q.get("tardias", ["0"])[0] == "1"
            corte = q.get("corte", [""])[0]
            with LOCK:
                notas = leer(NOTAS, {}); usadas = self._usadas(corte) if corte else set()
            # Ventana semiabierta [desde, hasta): una nota de las 9:45:00 va a un solo corte
            salida = [n for n in notas.values() if desde <= n.get("t", 0) < hasta]
            if tardias:
                # Publicadas hasta 6 h antes de la ventana pero vistas por primera vez despues de su comienzo (indexacion tardia)
                salida += [{**n, "tarde": True} for n in notas.values()
                           if desde - 6 * 3600000 <= n.get("t", 0) < desde and n.get("primera_vez", 0) > desde]
            # Nada que ya se haya considerado en otro corte
            salida = [n for n in salida if n.get("clave") not in usadas]
            # Las usadas cerca de la ventana: la misma nota puede volver por otra fuente con otra clave (titulo retocado)
            usadas_notas = [{k: n.get(k) for k in ("clave", "titulo", "medio", "link", "t")} for n in notas.values()
                            if n.get("clave") in usadas and desde - 6 * 3600000 <= n.get("t", 0) < hasta]
            return self._json(200, {"notas": salida, "usadas": sorted(usadas), "usadas_notas": usadas_notas})
        if u.path == "/recoleccion":
            q = parse_qs(u.query)
            try: desde = int(q.get("desde", ["0"])[0]); hasta = int(q.get("hasta", [str(10**15)])[0])
            except ValueError: return self._err(400, "desde/hasta deben ser milisegundos")
            with LOCK: corridas = sorted(t for t in leer(RECOLECCION, []) if desde <= t < hasta)
            puntos = [desde] + corridas + [min(hasta, int(time.time() * 1000))]
            hueco = max((b - a for a, b in zip(puntos, puntos[1:])), default=0)
            return self._json(200, {"corridas": len(corridas), "max_hueco_min": round(hueco / 60000)})
        if u.path == "/cortes/ultimo":
            try: antes = int(parse_qs(u.query).get("antes", [str(10**15)])[0])
            except ValueError: return self._err(400, "antes debe ser milisegundos")
            with LOCK: c = [x for x in leer(CORTES, []) if isinstance(x.get("hasta"), (int, float)) and x["hasta"] < antes]
            return self._json(200, {"corte": max(c, key=lambda x: x["hasta"]) if c else None})
        if u.path == "/calidad":
            dias = 30; limite = (time.time() - dias * 86400) * 1000
            with LOCK: cortes = [x for x in leer(CORTES, []) if x.get("guardado", 0) >= limite]; fb = leer(FEEDBACK, {})
            fp = {"n": 0, "errores": 0}   # relevantes que no lo eran (falsos positivos)
            fn = {"n": 0, "errores": 0}   # descartadas que si lo eran (falsos negativos)
            sen = {"n": 0, "errores": 0}
            ia = {"n": 0, "errores": 0}   # solo la IA, antes de la regla fija
            revisados = sin_clasificar = regla = 0
            for c in cortes:
                ck = f"{c.get('fecha')}|{c.get('corte')}"
                if not fb.get(f"__corte__||{ck}", {}).get("revisado"): continue
                revisados += 1; sin_clasificar += c.get("sin_clasificar", 0)
                for it in c.get("items", []):
                    f = fb.get(f"{it.get('clave')}||{ck}", {})
                    verdad = (f.get("rel") != "no_relevante") if it.get("rel") else (f.get("rel") == "si_relevante")
                    if it.get("rel"):
                        fp["n"] += 1; fp["errores"] += f.get("rel") == "no_relevante"
                    else:
                        fn["n"] += 1; fn["errores"] += f.get("rel") == "si_relevante"
                    if "rel_ia" in it:
                        ia["n"] += 1; ia["errores"] += bool(it["rel_ia"]) != verdad
                        regla += bool(it.get("rel")) != bool(it["rel_ia"])
                    if it.get("rel") and f.get("rel") != "no_relevante":
                        sen["n"] += 1; sen["errores"] += bool(f.get("sent")) and f["sent"] != it.get("sent")
            return self._json(200, {"dias": dias, "cortes": len(cortes), "cortes_revisados": revisados, "relevantes": fp, "descartadas": fn,
                                    "sentiment": sen, "solo_ia": ia, "por_regla_fija": regla, "sin_clasificar": sin_clasificar, "correcciones": len(fb),
                                    # Mientras haya un .corrupto, el servicio siguio con un archivo nuevo: el mail lo avisa en cada corte
                                    "corruptos": sorted(f for f in os.listdir(BASE) if f.endswith(".corrupto"))})
        self._err(404, "no existe")

    def _post(self):
        path = urlparse(self.path).path
        if path not in ("/generate", "/monitoreo", "/notas", "/cortes", "/feedback"): return self._err(404, "no existe")
        if not self._auth(): return
        try: data = self._body()
        except Exception as e: return self._err(400, "JSON ilegible", [str(e)])
        if path == "/notas":
            nuevas = data.get("notas") if isinstance(data, dict) else None
            if not isinstance(nuevas, list): return self._err(422, "se espera {\"notas\": [...]}")
            limite = (time.time() - RETENER_DIAS * 86400) * 1000
            with LOCK:
                notas = leer(NOTAS, {}); previas = set(notas); antes = len(notas)
                ahora_ms = int(time.time() * 1000)
                for n in nuevas:
                    if not isinstance(n, dict) or not n.get("clave") or not isinstance(n.get("t"), (int, float)): continue
                    previa = notas.get(n["clave"])
                    # primera_vez: cuando la vimos por primera vez (no se pisa). Las notas guardadas antes de este campo usan su t.
                    pv = previa.get("primera_vez", previa.get("t", ahora_ms)) if previa else ahora_ms
                    notas[n["clave"]] = {**(previa or {}), **n, "primera_vez": pv}
                notas = {k: v for k, v in notas.items() if v.get("t", 0) >= limite}
                agregadas = len(set(notas) - previas)
                escribir(NOTAS, notas)
                rc = [t for t in leer(RECOLECCION, []) if t >= limite] + [ahora_ms]; escribir(RECOLECCION, rc[-500:])
            return self._json(200, {"agregadas": agregadas, "total": len(notas), "antes": antes})
        if path == "/feedback":
            if not isinstance(data, dict) or not data.get("clave") or not data.get("corte") or data.get("tipo") not in TIPOS_REL + TIPOS_SENT + (TIPO_REVISADO,):
                return self._err(422, "se espera {clave, corte, tipo}")
            k = f"{data['clave']}||{data['corte']}"
            with LOCK:
                fb = leer(FEEDBACK, {}); f = fb.get(k, {})
                if data["tipo"] in TIPOS_REL: f["rel"] = data["tipo"]
                elif data["tipo"] == TIPO_REVISADO: f["revisado"] = True
                else: f["sent"] = data["tipo"]
                f["t"] = int(time.time() * 1000); fb[k] = f; escribir(FEEDBACK, fb)
            return self._json(200, {"ok": True})
        if path == "/cortes":
            if not isinstance(data, dict): return self._err(422, "se espera un objeto")
            with LOCK:
                clave = f"{data.get('fecha')}|{data.get('corte')}"
                c = [x for x in leer(CORTES, []) if f"{x.get('fecha')}|{x.get('corte')}" != clave]
                c.append({**data, "guardado": int(time.time() * 1000)}); escribir(CORTES, c[-200:])
            return self._json(200, {"ok": True})
        mon = path == "/monitoreo"
        errs = (gen_monitoreo if mon else gen_informe).validate(data)
        if errs: return self._err(422, "datos invalidos", errs)
        try:
            with tempfile.TemporaryDirectory() as d:
                out = os.path.join(d, "informe.pptx")
                gen_monitoreo.build(data, out) if mon else gen_informe.build(data, TPL, out)
                body = open(out, "rb").read()
        except SystemExit as e: return self._err(422, "no se pudo armar", [str(e)])
        except Exception as e: return self._err(500, "error interno", [repr(e)])
        name = (f"{data['cliente_corto']}_Monitoreo_{data['fecha'].replace(' ', '_')}_Corte{data['corte'].replace(':', '')}{'_EJEMPLO' if data.get('ejemplo') else ''}.pptx" if mon
                else f"Informe_{data['turno']}_{data['fecha'].replace(' ', '').replace('·', '-')}.pptx")
        self._send(200, body, "application/vnd.openxmlformats-officedocument.presentationml.presentation", {"Content-Disposition": f'attachment; filename="{name}"'})
    def log_message(self, fmt, *a): sys.stderr.write(time.strftime("%Y-%m-%d %H:%M:%S ") + "[informe] " + fmt % a + "\n")

if __name__ == "__main__":
    if not os.path.exists(TPL): raise SystemExit(f"No encuentro la plantilla: {TPL}")
    print(f"Escuchando en 0.0.0.0:{PORT} con plantilla {TPL}" + (" (con token)" if TOKEN else " (SIN token)"), flush=True); HTTPServer(("0.0.0.0", PORT), H).serve_forever()
