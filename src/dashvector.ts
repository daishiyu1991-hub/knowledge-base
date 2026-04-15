/**
 * DashVector HTTP Client
 * 阿里云向量检索服务 — upsert / search / delete
 */

const COLLECTION = 'hermes_memory';

interface DocPayload {
  agent_id: string;
  user_id: string;
  type: string;
  importance: number;
  created_at: number;
  content: string;
}

interface SearchHit {
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
        metric: 'cosine',
        fields_schema: {
          agent_id: 'string',
          user_id: 'string',
          type: 'string',
          importance: 'float',
          created_at: 'integer',
          content: 'string',
        },
      });
    } catch (err: any) {
      // 已存在不报错
      if (!err.message?.includes('already exists')) throw err;
    }
  }

  // ---- 写入 ----

  async upsert(id: string, vector: number[], payload: DocPayload): Promise<void> {
    await this.request('POST', `/collections/${COLLECTION}/docs`, {
      docs: [{ id, vector, fields: payload }],
    });
  }

  async batchUpsert(
    items: Array<{ id: string; vector: number[]; fields: DocPayload }>
  ): Promise<void> {
    // DashVector 单次最多 100 条
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      await this.request('POST', `/collections/${COLLECTION}/docs`, {
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
    const filterExpr: any = {
      op: 'and',
      clauses: [{ op: 'eq', field: 'agent_id', value: filter.agent_id }],
    };
    if (filter.user_id) {
      filterExpr.clauses.push({ op: 'eq', field: 'user_id', value: filter.user_id });
    }

    const resp = await this.request('POST', `/collections/${COLLECTION}/query`, {
      vector,
      filter: filterExpr,
      top_k: limit,
      include_vector: false,
    });

    return (resp.docs || []).map((doc: any) => ({
      id: doc.id,
      score: doc.score,
      fields: doc.fields,
    }));
  }

  // ---- 删除 ----

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.request('POST', `/collections/${COLLECTION}/docs/delete`, {
      ids,
    });
  }

  // ---- 健康检查 ----

  async stats(): Promise<{ docCount: number }> {
    const resp = await this.request('GET', `/collections/${COLLECTION}`);
    return { docCount: resp.doc_count ?? 0 };
  }

  // ---- 底层请求 ----

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.endpoint}${path}`;
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'dashvector-api-key': this.apiKey,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DashVector ${method} ${path} failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    if (json.code !== 0 && json.code !== 200) {
      throw new Error(`DashVector error: code=${json.code} message=${json.message}`);
    }
    return json;
  }
}
