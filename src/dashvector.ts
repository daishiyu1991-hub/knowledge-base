/**
 * DashVector HTTP Client
 * 阿里云向量检索服务 — upsert / search / delete
 */

const COLLECTION = 'hermes_memory';
const API_PREFIX = '/v1';
const REQUEST_TIMEOUT_MS = 10000;

interface DashVectorResponseBase {
  code: number;
  message?: string;
}

interface DashVectorQueryDoc {
  id: string;
  score: number;
  fields: DocPayload;
}

interface DashVectorQueryResponse extends DashVectorResponseBase {
  docs?: DashVectorQueryDoc[];
  output?: DashVectorQueryDoc[];
}

interface DashVectorCollectionResponse extends DashVectorResponseBase {
  doc_count?: number;
}

export interface DocPayload {
  agent_id: string;
  user_id: string;
  type: string;
  importance: number;
  created_at: number;
  content: string;
}

export interface SearchHit {
  id: string;
  score: number;
  fields: DocPayload;
}

export class DashVectorClient {
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  // ---- Collection 管理 ----

  async ensureCollection(dimension: number = 1024): Promise<void> {
    try {
      await this.request('POST', '/collections', {
        name: COLLECTION,
        dimension,
        dtype: 'FLOAT',
        metric: 'cosine',
        fields_schema: {
          agent_id: 'STRING',
          user_id: 'STRING',
          type: 'STRING',
          importance: 'FLOAT',
          created_at: 'FLOAT',
          content: 'STRING',
        },
      });
    } catch (err: unknown) {
      // 已存在不报错
      if (
        !(err instanceof Error) ||
        (!err.message.includes('already exists') && !err.message.includes('exist in db'))
      ) {
        throw err;
      }
    }
  }

  // ---- 写入 ----

  async upsert(id: string, vector: number[], payload: DocPayload): Promise<void> {
    await this.request('POST', `/collections/${COLLECTION}/docs/upsert`, {
      docs: [{ id, vector, fields: payload }],
    });
  }

  async batchUpsert(
    items: Array<{ id: string; vector: number[]; fields: DocPayload }>
  ): Promise<void> {
    // DashVector 单次最多 100 条
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      await this.request('POST', `/collections/${COLLECTION}/docs/upsert`, {
        docs: chunk,
      });
    }
  }

  // ---- 搜索 ----

  async search(
    vector: number[],
    filter: { agent_id: string; user_id?: string },
    limit: number = 10
  ): Promise<SearchHit[]> {
    const resp = await this.request<DashVectorQueryResponse>('POST', `/collections/${COLLECTION}/query`, {
      vector,
      filter: this.buildFilter(filter),
      topk: limit,
      include_vector: false,
    });

    const docs = resp.output || resp.docs || [];
    return docs.map((doc) => ({
      id: doc.id,
      score: doc.score,
      fields: doc.fields,
    }));
  }

  // ---- 删除 ----

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.request('DELETE', `/collections/${COLLECTION}/docs`, {
      ids,
    });
  }

  // ---- 健康检查 ----

  async stats(): Promise<{ docCount: number }> {
    const resp = await this.request<DashVectorCollectionResponse>('GET', `/collections/${COLLECTION}`);
    return { docCount: resp.doc_count ?? 0 };
  }

  private buildFilter(filter: { agent_id: string; user_id?: string }): string {
    const clauses = [`agent_id = '${escapeFilterValue(filter.agent_id)}'`];
    if (filter.user_id) {
      clauses.push(`user_id = '${escapeFilterValue(filter.user_id)}'`);
    }
    return clauses.join(' and ');
  }

  // ---- 底层请求 ----

  private async request<T extends DashVectorResponseBase>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.endpoint}${API_PREFIX}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'dashvector-auth-token': this.apiKey,
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DashVector ${method} ${path} failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as T;
    if (json.code !== 0) {
      throw new Error(`DashVector error: code=${json.code} message=${json.message}`);
    }
    return json;
  }
}

/**
 * In-memory vector store (for dev/testing).
 * Matches the minimal surface used by `src/index.ts`.
 */
export class MockVectorStore {
  private docs = new Map<string, { vector: number[]; fields: DocPayload }>();

  async ensureCollection(_dimension: number = 1024): Promise<void> {
    // no-op
  }

  async upsert(id: string, vector: number[], payload: DocPayload): Promise<void> {
    this.docs.set(id, { vector, fields: payload });
  }

  async search(
    vector: number[],
    filter: { agent_id: string; user_id?: string },
    limit: number = 10
  ): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    for (const [id, doc] of this.docs.entries()) {
      if (doc.fields.agent_id !== filter.agent_id) continue;
      if (filter.user_id && doc.fields.user_id !== filter.user_id) continue;
      hits.push({ id, score: cosine(vector, doc.vector), fields: doc.fields });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.docs.delete(id);
  }

  async stats(): Promise<{ docCount: number }> {
    return { docCount: this.docs.size };
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch (${a.length} vs ${b.length})`);
  }
  const n = a.length;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
