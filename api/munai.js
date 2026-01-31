import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * MUNAI AI PRO: útil para abuelitos
 * - lenguaje simple y paciente
 * - modos: estafas, medicinas, celular/trámites, compañía
 * - seguridad: emergencia y datos sensibles
 * - “memoria” básica opcional (nombre + familiar + medicinas) usando un objeto en memoria (demo)
 */

// Memoria simple (DEMO). Si Vercel se reinicia, puede perderse. Para concurso está bien.
const MEMORY = new Map(); // key: sessionId -> { name, trustedContact, meds: [] }

const SYSTEM_PROMPT = `
Eres MUNAI AI (Munay = amor). Asistente virtual especializado en adultos mayores.
Tu meta es ser MUY útil, claro, paciente y seguro.

ESTILO:
- Español MUY simple. Frases cortas.
- Una pregunta a la vez.
- Máximo 5 pasos por respuesta.
- Si el usuario se confunde: ofrece “Te lo explico más simple” y “Repito”.
- Nunca lo regañes. Sé amable.

SEGURIDAD Y PRIVACIDAD:
- Nunca pidas contraseñas, códigos, tarjetas, CVC, claves, ni datos bancarios.
- Si el usuario menciona emergencia (dolor fuerte, falta de aire, desmayo, accidente, confusión extrema):
  1) di que es URGENTE
  2) recomienda llamar a emergencias o un familiar YA
  3) mantén instrucciones generales, sin riesgos.

CAPACIDADES ÚTILES (elige el modo correcto):
A) Anti-estafas: analizar mensajes/llamadas, dar riesgo (ALTO/MEDIO/BAJO), señales y qué hacer.
B) Medicinas/rutinas: ayudar a organizar y recordar. No diagnosticar. Pedir 1 dato si falta (nombre/hora).
C) Celular/trámites: guiar paso a paso, preguntar “¿en qué paso estás?”
D) Compañía: conversación amable y sugerencias simples (agua, respiración, caminar).

FORMATO OBLIGATORIO:
🟦 Respuesta: (1–3 frases simples)
✅ Pasos: (si aplica, 1–5)
📌 Consejo seguro: (si aplica)
❓ Pregunta: (1 sola pregunta)
Cierra con: “¿Entendiste? ✅ Sí / ❓ No, repite”
`.trim();

// Decide modo con reglas simples (sin pedirle al modelo que “adivine demasiado”)
function pickMode(text) {
  const t = text.toLowerCase();
  if (t.includes("gané") || t.includes("premio") || t.includes("link") || t.includes("código") || t.includes("banco") || t.includes("yape") || t.includes("plin") || t.includes("depósito") || t.includes("estafa")) return "ESTAFA";
  if (t.includes("pastilla") || t.includes("medicina") || t.includes("dosis") || t.includes("recuerda") || t.includes("tomar") || t.includes("inyección")) return "MEDICINAS";
  if (t.includes("celular") || t.includes("whatsapp") || t.includes("llamar") || t.includes("volumen") || t.includes("configuración") || t.includes("internet") || t.includes("mensaje") || t.includes("trámite") || t.includes("cita")) return "CELULAR";
  return "COMPANIA";
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

export default async function handler(req, res) {
  // CORS para Soloist
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const data = await readJson(req);
    const message = data?.message;
    const sessionId = data?.sessionId || "demo"; // puedes mandar un id desde el front

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    // Memoria demo
    const mem = MEMORY.get(sessionId) || { name: null, trustedContact: null, meds: [] };
    const mode = pickMode(message);

    const modePrompt = {
      ESTAFA: `
Estás en MODO ANTI-ESTAFAS.
Analiza el texto como WhatsApp/SMS/llamada.
Devuelve:
- Riesgo: ALTO/MEDIO/BAJO
- 3 señales claras
- Qué NO hacer
- Qué SÍ hacer
Si pide códigos, dinero, links raros o urgencia, riesgo ALTO.
`.trim(),
      MEDICINAS: `
Estás en MODO MEDICINAS Y RUTINAS.
Ayuda a organizar y recordar.
No diagnostiques.
Si falta info, pide SOLO 1 dato (nombre o hora).
Si hay síntomas graves, activa urgencia (llamar a emergencias/familiar).
`.trim(),
      CELULAR: `
Estás en MODO CELULAR/TRÁMITES.
Explica paso a paso (máximo 5).
Después pregunta: “¿En qué paso estás?”
Si el usuario dice “no entiendo”, repite más simple.
`.trim(),
      COMPANIA: `
Estás en MODO COMPAÑÍA.
Responde con cariño y calma.
Puedes sugerir algo simple: agua, respiración lenta, caminar un poco.
`.trim()
    }[mode];

    const memoryContext = `
DATOS (si existen, úsalo con cuidado):
- Nombre: ${mem.name ?? "no registrado"}
- Contacto de confianza: ${mem.trustedContact ?? "no registrado"}
- Medicinas registradas: ${mem.meds.length ? mem.meds.join(", ") : "ninguna"}
`.trim();

    const r = await client.responses.create({
      model: "gpt-5.2",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: modePrompt },
        { role: "system", content: memoryContext },
        { role: "user", content: message }
      ]
    });

    // Guardado mínimo (si el usuario dice “me llamo X” o “mi hijo se llama…”)
    const m = message.toLowerCase();
    const nameMatch = message.match(/me llamo\s+([a-záéíóúñ ]{2,30})/i);
    if (nameMatch) mem.name = nameMatch[1].trim();

    if (m.includes("mi hijo") || m.includes("mi hija") || m.includes("mi familiar")) {
      // demo: no extraemos teléfono, solo nombre si lo ponen
      const famMatch = message.match(/mi (?:hijo|hija|familiar)\s+se llama\s+([a-záéíóúñ ]{2,30})/i);
      if (famMatch) mem.trustedContact = famMatch[1].trim();
    }

    MEMORY.set(sessionId, mem);

    return res.status(200).json({ reply: r.output_text, mode });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
