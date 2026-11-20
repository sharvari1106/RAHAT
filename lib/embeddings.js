// Sentence embeddings computed locally (no paid API) with transformers.js.
// Model: paraphrase-multilingual-MiniLM-L12-v2 -> 384-dimensional vectors, trained on 50+ languages,
// so "ಮನೆಗೆ ನೀರು ನುಗ್ಗಿದೆ", "ghar mein paani bhar gaya" and "water entered the house" land close together.
// The model (~120 MB) downloads once on first use and is cached on disk.

const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIM = 384;

const g = globalThis;

async function getExtractor() {
  if (!g.__rahatExtractor) {
    g.__rahatExtractor = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    );
  }
  return g.__rahatExtractor;
}

/**
 * Embed one or more texts. Returns number[][] (L2-normalised, so cosine = dot product),
 * or null if embeddings are disabled / the model could not load - the app then falls back
 * to distance, phone and name matching only.
 */
export async function embed(texts) {
  if (process.env.EMBEDDINGS_DISABLED === '1') return null;
  const list = Array.isArray(texts) ? texts : [texts];
  if (!list.length) return [];
  try {
    const extractor = await getExtractor();
    const output = await extractor(list, { pooling: 'mean', normalize: true });
    return output.tolist();
  } catch (e) {
    g.__rahatExtractor = null;
    console.warn('[embeddings] unavailable, semantic matching is off:', e.message);
    return null;
  }
}

export async function embedOne(text) {
  const v = await embed([text]);
  return v ? v[0] : null;
}

/** pgvector literal: [0.12,-0.03,...] */
export function toPgVector(vec) {
  return vec ? `[${vec.map((x) => Number(x).toFixed(6)).join(',')}]` : null;
}

/** What an SOS "means": the situation in the caller's own words + the landmark */
export function sosText({ description, landmark }) {
  return [description, landmark].filter(Boolean).join(' | ');
}

/**
 * A person described the same way for camp residents and for missing-person reports, so the two
 * can be compared: name, age, gender, village and the identifying description.
 */
export function personText({ full_name, age, gender, home_village, marks, description, last_seen_place }) {
  return [
    full_name,
    age != null ? `${age} years` : '',
    gender && gender !== 'unknown' ? gender : '',
    home_village ? `from ${home_village}` : '',
    marks || description || '',
    last_seen_place ? `last seen at ${last_seen_place}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}
