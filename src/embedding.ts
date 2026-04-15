/**
 * DashScope Embedding Service
 * 通义 text-embedding-v3 — 1024 维
 */

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const MODEL = 'text-embedding-v3';
export const EMBEDDING_DIMENSION = 1024;

interface EmbeddingResponse {
  output: {
    embeddings: Array<{ embedding: number[]; text_index: number }>;
  };
  usage: {
    total_tokens: number;
  };
}

export class EmbeddingService {
  private apiKey: string;
  private cache = new Map<string, number[]>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const results = await this.batchEmbed([text]);
    const vector = results[0];
    this.cache.set(text, vector);
    return vector;
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    // 分离缓存命中和未命中
    const results: number[][] = new Array(texts.length);
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    if (uncached.length === 0) return results;

    // DashScope 单次最多 25 条
    for (let batch = 0; batch < uncached.length; batch += 25) {
      const chunk = uncached.slice(batch, batch + 25);
      const chunkTexts = chunk.map((c) => c.text);

      const resp = await this.callApi(chunkTexts);

      for (let j = 0; j < chunk.length; j++) {
        const embedding = resp.output.embeddings[j];
        const vector = embedding.embedding;
        results[chunk[j].index] = vector;
        this.cache.set(chunk[j].text, vector);
      }
    }

    return results;
  }

  private async callApi(texts: string[]): Promise<EmbeddingResponse> {
    const res = await fetch(DASHSCOPE_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        input: { texts },
        parameters: { dimension: EMBEDDING_DIMENSION, text_type: 'document' },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DashScope embedding failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<EmbeddingResponse>;
  }
}

/**
 * Local deterministic embedding (for dev/testing).
 *
 * - 1024维，便于与 DashVector schema 对齐
 * - 同一文本生成稳定向量（便于复现）
 */
export class MockEmbeddingService {
  private cache = new Map<string, number[]>();

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const v = makeDeterministicVector(text);
    this.cache.set(text, v);
    return v;
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

function makeDeterministicVector(text: string): number[] {
  const seed = fnv1a32(text);
  let x = seed || 1;

  const v = new Array<number>(EMBEDDING_DIMENSION);
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;

    // map to [-1, 1]
    const val = ((x >>> 0) / 0xffffffff) * 2 - 1;
    v[i] = val;
    sumSq += val * val;
  }

  // normalize so cosine similarity works
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
  return v;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
