import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase/config';

const REGION = 'us-central1';
let _callable = null;

function getCallable() {
  if (!_callable) {
    _callable = httpsCallable(getFunctions(app, REGION), 'geminiGenerate');
  }
  return _callable;
}

/**
 * Genera texto con Gemini: primero Cloud Function (seguro), luego fallback local (.env).
 * @param {{ prompt?: string, parts?: Array, model?: string, generationConfig?: object }} opts
 * @returns {Promise<{ text: string, source: 'cloud' | 'local' }>}
 */
export async function generateGeminiText(opts = {}) {
  const { prompt, parts, model = 'gemini-2.5-flash', generationConfig } = opts;

  try {
    const result = await getCallable()({ prompt, parts, model, generationConfig });
    const text = result?.data?.text;
    if (text) return { text, source: 'cloud' };
  } catch (err) {
    const code = err?.code || '';
    const retryable = [
      'functions/not-found',
      'functions/unavailable',
      'functions/failed-precondition',
      'unavailable',
    ];
    if (!retryable.some((c) => code.includes(c) || String(err.message).includes(c))) {
      console.warn('[Gemini] Cloud Function:', err.message || err);
    }
  }

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_UNAVAILABLE');
  }

  const body = {
    contents: [{ parts: parts?.length ? parts : [{ text: prompt }] }],
  };
  if (generationConfig) body.generationConfig = generationConfig;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Error al contactar con la IA (${response.status})`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Respuesta vacía de Gemini');
  return { text, source: 'local' };
}

export const GEMINI_SETUP_MSG =
  "Configura GEMINI_API_KEY en Cloud Functions (recomendado) o VITE_GEMINI_API_KEY en .env (fallback temporal).";
