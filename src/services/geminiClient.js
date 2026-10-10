import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase/config';
import { requestGemini } from './geminiGateway';

const REGION = 'us-central1';
let _callable = null;

function getCallable() {
  if (!_callable) {
    _callable = httpsCallable(getFunctions(app, REGION), 'geminiGenerate', { timeout: 125_000 });
  }
  return _callable;
}

/** Generate through the authenticated server proxy only. No browser API key. */
export async function generateGeminiText(opts = {}) {
  return requestGemini(getCallable(), opts);
}

export const GEMINI_SETUP_MSG =
  'La IA no está disponible en este momento. Podés continuar trabajando con los registros del sistema.';
