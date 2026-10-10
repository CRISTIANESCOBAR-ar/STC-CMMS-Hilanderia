export const ALLOWED_ROLES = new Set([
  'admin', 'gerente_produccion', 'jefe_sector', 'jefe_electricos',
  'jefe_produccion', 'supervisor', 'supervisor_mecanico',
  'supervisor_electrico', 'inspector', 'mecanico', 'tejedor', 'auxiliar',
]);

const MAX_TEXT = 120_000;
const MAX_PAYLOAD = 8_000_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const invalid = (message) => { throw new Error(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateGeminiRequest(data) {
  if (!isObject(data)) invalid('Solicitud inválida.');
  if (JSON.stringify(data).length > MAX_PAYLOAD) invalid('Solicitud demasiado grande.');
  const { prompt = '', model = 'gemini-2.5-flash', parts = null, generationConfig = null } = data;
  if (model !== 'gemini-2.5-flash') invalid('Modelo no autorizado.');
  if (typeof prompt !== 'string') invalid('Prompt inválido.');
  if (prompt.length > MAX_TEXT) invalid('Prompt demasiado largo.');
  if (parts !== null && (!Array.isArray(parts) || parts.length > 8)) invalid('Parts inválidos.');
  const normalized = [];
  let textLength = prompt.length;
  for (const part of parts || []) {
    if (!isObject(part)) invalid('Parte inválida.');
    const keys = Object.keys(part);
    if (keys.length !== 1) invalid('Cada parte debe contener texto o imagen.');
    if (keys[0] === 'text') {
      if (typeof part.text !== 'string') invalid('Texto inválido.');
      textLength += part.text.length;
      normalized.push({ text: part.text });
    } else if (keys[0] === 'inline_data' || keys[0] === 'inlineData') {
      const image = part[keys[0]];
      if (!isObject(image)) invalid('Imagen inválida.');
      const mimeType = image.mime_type ?? image.mimeType;
      if (!IMAGE_TYPES.has(mimeType) || typeof image.data !== 'string' || !image.data.length
          || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
        invalid('Formato de imagen inválido.');
      }
      normalized.push({ inlineData: { mimeType, data: image.data } });
    } else {
      invalid('Tipo de parte no autorizado.');
    }
  }
  if (textLength > MAX_TEXT) invalid('Texto demasiado largo.');
  if (!normalized.length) {
    if (!prompt.trim()) invalid('Se requiere prompt o parts.');
    normalized.push({ text: prompt });
  }

  const config = { maxOutputTokens: 8192 };
  if (generationConfig !== null) {
    if (!isObject(generationConfig)) invalid('Configuración inválida.');
    for (const key of Object.keys(generationConfig)) {
      if (!['temperature', 'maxOutputTokens', 'responseMimeType'].includes(key)) {
        invalid('Configuración no autorizada.');
      }
    }
    if ('temperature' in generationConfig) {
      const value = generationConfig.temperature;
      if (!Number.isFinite(value) || value < 0 || value > 2) invalid('Temperatura inválida.');
      config.temperature = value;
    }
    if ('maxOutputTokens' in generationConfig) {
      const value = generationConfig.maxOutputTokens;
      if (!Number.isInteger(value) || value < 1 || value > 8192) invalid('Límite de salida inválido.');
      config.maxOutputTokens = value;
    }
    if ('responseMimeType' in generationConfig) {
      if (!['text/plain', 'application/json'].includes(generationConfig.responseMimeType)) {
        invalid('Formato de respuesta inválido.');
      }
      config.responseMimeType = generationConfig.responseMimeType;
    }
  }
  return { model, body: { contents: [{ parts: normalized }], generationConfig: config } };
}

export const QUOTA_WINDOW_MS = 10 * 60 * 1000;
export const QUOTA_REQUESTS = 12;

/** Fixed window per user; the caller persists this within a Firestore transaction. */
export function nextQuota(previous, now) {
  const active = previous && Number.isFinite(previous.windowStart)
    && now >= previous.windowStart && now - previous.windowStart < QUOTA_WINDOW_MS;
  const count = active ? previous.count : 0;
  if (!Number.isInteger(count) || count < 0 || count >= QUOTA_REQUESTS) return null;
  return { windowStart: active ? previous.windowStart : now, count: count + 1 };
}
