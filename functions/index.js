import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getStorage } from 'firebase-admin/storage';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { validUploadPath, revokeDownloadToken } from './operationalImages.js';
import { ALLOWED_ROLES, validateGeminiRequest, nextQuota } from './geminiPolicy.js';

initializeApp();
const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const finalizeOperationalUpload = onCall({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 10 }, async request => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Se requiere una cuenta identificada.');
  }
  const snapshot = await getFirestore().doc(`usuarios/${request.auth.uid}`).get();
  const path = request.data?.path;
  if (!snapshot.exists || !validUploadPath(snapshot.data(), request.auth.uid, path)) {
    throw new HttpsError('permission-denied', 'Archivo fuera del alcance autorizado.');
  }
  await revokeDownloadToken(getStorage().bucket().file(path));
  return { path };
});

// Also protects orphaned uploads when a browser closes before finalization.
export const revokeOperationalDownloadToken = onObjectFinalized({ region: 'us-central1', retry: true, maxInstances: 5 }, async event => {
  const name = event.data.name;
  if (!name || !/^(novedades|intervenciones)\/(HILANDERIA|TEJEDURIA)\/[^/]+\/[^/]+$/.test(name)) return;
  await revokeDownloadToken(getStorage().bucket(event.data.bucket).file(name));
});

async function authorizeCaller(auth) {
  if (!auth || auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión con una cuenta identificada.');
  }
  const profile = await getFirestore().doc(`usuarios/${auth.uid}`).get();
  if (!profile.exists || !ALLOWED_ROLES.has(profile.data()?.role)) {
    throw new HttpsError('permission-denied', 'Usuario no autorizado para IA.');
  }
}

async function consumeQuota(uid) {
  const db = getFirestore();
  // Client access is denied by the catch-all rule. One document per user.
  const quotaRef = db.doc(`_ai_rate_limits/${uid}`);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(quotaRef);
    const quota = nextQuota(snap.exists ? snap.data() : null, Date.now());
    if (!quota) {
      throw new HttpsError('resource-exhausted', 'Se alcanzó el límite de IA. Intentá de nuevo en unos minutos.');
    }
    transaction.set(quotaRef, quota);
  });
}

/** Gemini credentials and authorization remain exclusively on the server. */
export const geminiGenerate = onCall(
  {
    secrets: [geminiApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 10,
    concurrency: 10,
  },
  async (request) => {
    await authorizeCaller(request.auth);
    let validated;
    try {
      validated = validateGeminiRequest(request.data);
    } catch (error) {
      throw new HttpsError('invalid-argument', error.message);
    }
    const apiKey = geminiApiKey.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Servicio de IA no configurado.');
    }
    await consumeQuota(request.auth.uid);
    const { model, body } = validated;
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        }
      );
    } catch {
      throw new HttpsError('unavailable', 'La IA no respondió. Intentá de nuevo más tarde.');
    }
    if (!response.ok) {
      // Do not log prompts, provider bodies, personal data or credentials.
      console.error('Gemini request failed', { status: response.status });
      throw new HttpsError(
        response.status === 429 ? 'resource-exhausted' : 'unavailable',
        'La IA está temporalmente ocupada. Intentá de nuevo más tarde.'
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new HttpsError('unavailable', 'Respuesta inválida del servicio de IA.');
    }
    const text = data?.candidates?.[0]?.content?.parts
      ?.filter(part => typeof part.text === 'string').map(part => part.text).join('\n');
    if (!text?.trim()) throw new HttpsError('unavailable', 'Respuesta vacía de IA.');
    return { text, model };
  }
);
