import Fastify, { type FastifyInstance } from 'fastify';
import Cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { v4 as uuid } from 'uuid';
import { EMBEDDING_DIMENSION, EmbeddingService, MockEmbeddingService } from './embedding.js';
import { DashVectorClient, MockVectorStore } from './dashvector.js';

export const DEFAULT_PORT = 3010;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_DB_PATH = './data/memories.db';
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
const MAX_CONTENT_LENGTH = 4000;
const MAX_QUERY_LENGTH = 1000;
const MAX_AGENT_ID_LENGTH = 64;
const MAX_USER_ID_LENGTH = 128;

interface MemoryInput {
  agent_id: string;
  user_id?: string;
  type?: 'fact' | 'preference' | 'context' | 'episode' | 'skill';
  content: string;
  importance?: number;
}

interface SearchInput {
  agent_id: string;
  user_id?: string;
  query: string;
  limit?: number;
}

type EmbeddingLike = {
  embed(text: string): Promise<number[]>;
};

type SearchHit = {
  id: string;
  score: number;
  fields: {
    type: string;
    content: string;
    importance: number;
    created_at: number;
  };
};

type VectorStoreLike = {
  ensureCollection(dimension: number): Promise<void>;
  upsert(
    id: string,
    vector: number[],
    payload: {
      agent_id: string;
      user_id: string;
      type: string;
      importance: number;
      created_at: number;
      content: string;
    }
  ): Promise<void>;
  search(
    vector: number[],
    filter: { agent_id: string; user_id?: string },
    limit?: number
  ): Promise<SearchHit[]>;
  delete(ids: string[]): Promise<void>;
  stats(): Promise<{ docCount: number }>;
};

interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  apiKey: string;
  dashvectorApiKey: string;
  dashvectorEndpoint: string;
  dashscopeApiKey: string;
  memoryMock: boolean;
}

interface BuildAppOptions {
  env?: NodeJS.ProcessEnv;
  config?: AppConfig;
  embedding?: EmbeddingLike;
  dv?: VectorStoreLike;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config: AppConfig = {
    port: parseInt(env.PORT || String(DEFAULT_PORT), 10),
    host: env.HOST || DEFAULT_HOST,
    dbPath: env.DB_PATH || DEFAULT_DB_PATH,
    apiKey: env.MEMORY_SERVICE_API_KEY || '',
    dashvectorApiKey: env.DASHVECTOR_API_KEY || '',
    dashvectorEndpoint: env.DASHVECTOR_ENDPOINT || '',
    dashscopeApiKey: env.DASHSCOPE_API_KEY || '',
    memoryMock: env.MEMORY_MOCK === '1',
  };

  if (
    config.memoryMock &&
    (env.NODE_ENV === 'production' ||
      config.dashvectorApiKey ||
      config.dashvectorEndpoint ||
      config.dashscopeApiKey)
  ) {
    throw new Error(
      'MEMORY_MOCK=1 is for local dev only and cannot be used with production settings or real API keys'
    );
  }

  if (!config.apiKey) {
    throw new Error('Missing required env var: MEMORY_SERVICE_API_KEY');
  }

  if (
    !config.memoryMock &&
    (!config.dashvectorApiKey || !config.dashvectorEndpoint || !config.dashscopeApiKey)
  ) {
    throw new Error(
      'Missing required env vars: DASHVECTOR_API_KEY, DASHVECTOR_ENDPOINT, DASHSCOPE_API_KEY'
    );
  }

  return config;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? resolveConfig(options.env);
  const fastify = Fastify({ logger: { level: 'info' } });
  await fastify.register(Cors, { origin: false });

  if (config.memoryMock) {
    fastify.log.warn(
      'MEMORY_MOCK=1 enabled. Vector store is in-memory only and search data is lost on restart. Do not use in production.'
    );
  }

  const embedding =
    options.embedding ??
    (config.memoryMock ? new MockEmbeddingService() : new EmbeddingService(config.dashscopeApiKey));
  const dv =
    options.dv ??
    (config.memoryMock
      ? new MockVectorStore()
      : new DashVectorClient(config.dashvectorEndpoint, config.dashvectorApiKey));

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      synced_to_dv INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_user ON memories(agent_id, user_id);
  `);

  const stmts = {
    insert: db.prepare(
      `INSERT INTO memories (id, agent_id, user_id, type, content, importance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    get: db.prepare('SELECT * FROM memories WHERE id = ?'),
    deleteById: db.prepare('DELETE FROM memories WHERE id = ?'),
    listByAgent: db.prepare(
      'SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ),
    listByAgentUser: db.prepare(
      'SELECT * FROM memories WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'
    ),
  };

  try {
    await dv.ensureCollection(EMBEDDING_DIMENSION);
    fastify.log.info(config.memoryMock ? 'Mock vector store ready' : 'DashVector collection ready');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to initialize vector store');
    await fastify.close();
    throw error;
  }

  fastify.addHook('onClose', async () => {
    db.close();
  });

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.headers['x-memory-api-key'] !== config.apiKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.post<{ Body: MemoryInput }>('/api/memory', async (req, reply) => {
    const validationError = validateMemoryInput(req.body);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const { agent_id, user_id = '', type = 'fact', content, importance = 0.5 } = req.body;

    const id = uuid();
    const now = Date.now();
    const vector = await embedding.embed(content);

    await dv.upsert(id, vector, {
      agent_id,
      user_id,
      type,
      importance,
      created_at: now,
      content,
    });

    stmts.insert.run(id, agent_id, user_id, type, content, importance, now);
    return { id, status: 'ok' };
  });

  fastify.post<{ Body: SearchInput }>('/api/memory/search', async (req, reply) => {
    const validationError = validateSearchInput(req.body);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const { agent_id, user_id, query, limit = 10 } = req.body;
    const vector = await embedding.embed(query);
    const hits = await dv.search(vector, { agent_id, user_id }, normalizeLimit(limit, 10));

    return {
      results: hits.map((h) => ({
        id: h.id,
        score: h.score,
        type: h.fields.type,
        content: h.fields.content,
        importance: h.fields.importance,
        created_at: h.fields.created_at,
      })),
    };
  });

  fastify.delete<{ Params: { id: string }; Querystring: { agent_id: string } }>(
    '/api/memory/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { agent_id } = req.query;

      if (!agent_id) {
        return reply.status(400).send({ error: 'agent_id is required' });
      }

      const row = stmts.get.get(id) as { agent_id: string } | undefined;
      if (!row) {
        return reply.status(404).send({ error: 'Memory not found' });
      }
      if (row.agent_id !== agent_id) {
        return reply.status(403).send({ error: 'Forbidden: not your memory' });
      }

      await dv.delete([id]);
      stmts.deleteById.run(id);
      return { status: 'ok' };
    }
  );

  fastify.get('/api/memory/health', async () => {
    const dvStats = await dv.stats().catch(() => ({ docCount: -1 }));
    const localCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    return {
      status: 'ok',
      mode: config.memoryMock ? 'mock' : 'dashvector',
      dashvector_docs: dvStats.docCount,
      local_docs: localCount,
    };
  });

  fastify.get<{
    Querystring: { agent_id: string; user_id?: string; limit?: number | string };
  }>('/api/memory', async (req, reply) => {
    const { agent_id, user_id } = req.query;
    if (!agent_id) return reply.status(400).send({ error: 'agent_id required' });

    const limit = normalizeLimit(req.query.limit, DEFAULT_LIST_LIMIT);
    const rows = user_id
      ? stmts.listByAgentUser.all(agent_id, user_id, limit)
      : stmts.listByAgent.all(agent_id, limit);
    return { results: rows };
  });

  return fastify;
}

export async function startApp(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  const config = resolveConfig(env);
  const app = await buildApp({ env, config });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Memory service listening on ${config.host}:${config.port}`);
  return app;
}

function normalizeLimit(value: number | string | undefined, fallback: number): number {
  const raw = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (raw == null || Number.isNaN(raw) || raw < 1) return fallback;
  return Math.min(raw, MAX_LIST_LIMIT);
}

function validateMemoryInput(body: MemoryInput): string | null {
  if (!body?.agent_id || !body?.content) {
    return 'agent_id and content are required';
  }
  if (body.agent_id.length > MAX_AGENT_ID_LENGTH) {
    return `agent_id must be at most ${MAX_AGENT_ID_LENGTH} characters`;
  }
  if (body.user_id && body.user_id.length > MAX_USER_ID_LENGTH) {
    return `user_id must be at most ${MAX_USER_ID_LENGTH} characters`;
  }
  if (body.content.length > MAX_CONTENT_LENGTH) {
    return `content must be at most ${MAX_CONTENT_LENGTH} characters`;
  }
  if (body.type && !['fact', 'preference', 'context', 'episode', 'skill'].includes(body.type)) {
    return 'type must be one of: fact, preference, context, episode, skill';
  }
  if (
    body.importance != null &&
    (!Number.isFinite(body.importance) || body.importance < 0 || body.importance > 1)
  ) {
    return 'importance must be a finite number between 0 and 1';
  }
  return null;
}

function validateSearchInput(body: SearchInput): string | null {
  if (!body?.agent_id || !body?.query) {
    return 'agent_id and query are required';
  }
  if (body.agent_id.length > MAX_AGENT_ID_LENGTH) {
    return `agent_id must be at most ${MAX_AGENT_ID_LENGTH} characters`;
  }
  if (body.user_id && body.user_id.length > MAX_USER_ID_LENGTH) {
    return `user_id must be at most ${MAX_USER_ID_LENGTH} characters`;
  }
  if (body.query.length > MAX_QUERY_LENGTH) {
    return `query must be at most ${MAX_QUERY_LENGTH} characters`;
  }
  if (
    body.limit != null &&
    typeof body.limit !== 'number' &&
    !Number.isFinite(Number.parseInt(String(body.limit), 10))
  ) {
    return 'limit must be a positive integer';
  }
  return null;
}

