/**
 * DashScope Embedding Service
 * 通义 text-embedding-v3 — 1024 维
 */

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const MODEL = 'text-embedding-v3';
const DIMENSION = 1024;

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
        parameters: { dimension: DIMENSION, text_type: 'document' },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DashScope embedding failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<EmbeddingResponse>;
  }
}
