import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const ALLOWED_ROLES = new Set([
  'admin',
  'gerente_produccion',
  'jefe_sector',
  'jefe_electricos',
  'jefe_produccion',
  'supervisor',
  'supervisor_mecanico',
  'supervisor_electrico',
  'inspector',
  'mecanico',
  'tejedor',
]);

const MAX_PROMPT_CHARS = 120_000;

async function getCallerRole(uid) {
  const snap = await getFirestore().doc(`usuarios/${uid}`).get();
  if (!snap.exists) return 'mecanico';
  return snap.data()?.role || 'mecanico';
}

/**
 * Proxy seguro para Gemini. La API key vive solo en Secret Manager (GEMINI_API_KEY).
 * El cliente puede seguir usando VITE_GEMINI_API_KEY como fallback hasta junio.
 */
export const geminiGenerate = onCall(
  {
    secrets: [geminiApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const role = await getCallerRole(request.auth.uid);
    if (!ALLOWED_ROLES.has(role)) {
      throw new HttpsError('permission-denied', 'Rol no autorizado para IA.');
    }

    const apiKey = geminiApiKey.value();
    if (!apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'GEMINI_API_KEY no configurada en Functions. Usa fallback local o configura el secret.'
      );
    }

    const {
      prompt = '',
      model = 'gemini-2.5-flash',
      parts = null,
      generationConfig = null,
    } = request.data || {};

    if (!prompt && (!parts || !parts.length)) {
      throw new HttpsError('invalid-argument', 'Se requiere prompt o parts.');
    }

    if (prompt && prompt.length > MAX_PROMPT_CHARS) {
      throw new HttpsError('invalid-argument', 'Prompt demasiado largo.');
    }

    const body = {
      contents: [
        {
          parts: parts?.length
            ? parts
            : [{ text: prompt }],
        },
      ],
    };
    if (generationConfig) {
      body.generationConfig = generationConfig;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error', response.status, errText.slice(0, 500));
      throw new HttpsError('internal', `Error Gemini (${response.status})`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new HttpsError('internal', 'Respuesta vacía de Gemini.');
    }

    return { text, model };
  }
);
