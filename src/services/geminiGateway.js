const UNAVAILABLE_CODES = new Set([
  'functions/not-found', 'functions/unavailable', 'functions/failed-precondition',
  'functions/deadline-exceeded', 'functions/internal',
]);

/** Dependency injection lets us verify denials without calling Firebase or Gemini. */
export async function requestGemini(callable, opts = {}) {
  const { prompt, parts, model = 'gemini-2.5-flash', generationConfig } = opts;
  const payload = { model };
  if (prompt !== undefined) payload.prompt = prompt;
  if (parts !== undefined) payload.parts = parts;
  if (generationConfig !== undefined) payload.generationConfig = generationConfig;

  try {
    const result = await callable(payload);
    const text = result?.data?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('GEMINI_UNAVAILABLE');
    return { text, source: 'cloud' };
  } catch (error) {
    if (UNAVAILABLE_CODES.has(error?.code)) {
      throw new Error('GEMINI_UNAVAILABLE', { cause: error });
    }
    // Preserve permission, authentication, quota and invalid-input failures.
    throw error;
  }
}
