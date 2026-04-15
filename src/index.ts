/**
 * Memory Service — Hermes Agent 向量记忆中间件
 *
 * POST   /api/memory          保存记忆
 * POST   /api/memory/search   语义搜索
 * DELETE /api/memory/:id       删除记忆
 * GET    /api/memory/health    健康检查
 */

import Fastify from 'fastify';
import Cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { EMBEDDING_DIMENSION, EmbeddingService, MockEmbeddingService } from './embedding.js';
import { DashVectorClient, MockVectorStore } from './dashvector.js';
import 'dotenv/config';

// ---- 配置 ----

const PORT = parseInt(process.env.PORT || '3010', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || './data/memories.db';
const DASHVECTOR_API_KEY = process.env.DASHVECTOR_API_KEY || '';
const DASHVECTOR_ENDPOINT = process.env.DASHVECTOR_ENDPOINT || '';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const MEMORY_MOCK = process.env.MEMORY_MOCK === '1';

if (!MEMORY_MOCK && (!DASHVECTOR_API_KEY || !DASHVECTOR_ENDPOINT || !DASHSCOPE_API_KEY)) {
  console.error(
    'Missing required env vars: DASHVECTOR_API_KEY, DASHVECTOR_ENDPOINT, DASHSCOPE_API_KEY (or set MEMORY_MOCK=1 for local dev)'
  );
  process.exit(1);
}

if (MEMORY_MOCK) {
  process.stdout.write(
    '\nWARNING: MEMORY_MOCK=1 enabled. Vector store is in-memory only (search data is lost on restart). Do NOT use in production.\n\n'
  );
}

// ---- 初始化 ----

const fastify = Fastify({ logger: { level: 'info' } });
await fastify.register(Cors, { origin: true });

const embedding = MEMORY_MOCK ? new MockEmbeddingService() : new EmbeddingService(DASHSCOPE_API_KEY);
const dv = MEMORY_MOCK ? new MockVectorStore() : new DashVectorClient(DASHVECTOR_ENDPOINT, DASHVECTOR_API_KEY);

// SQLite 元数据备份
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
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

// 确保 DashVector collection 存在
await dv.ensureCollection(EMBEDDING_DIMENSION);
fastify.log.info(MEMORY_MOCK ? 'Mock vector store ready' : 'DashVector collection ready');

// ---- 类型 ----

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

// ---- 路由 ----

/** 保存记忆 */
fastify.post<{ Body: MemoryInput }>('/api/memory', async (req, reply) => {
  const { agent_id, user_id = '', type = 'fact', content, importance = 0.5 } = req.body;

  if (!agent_id || !content) {
    return reply.status(400).send({ error: 'agent_id and content are required' });
  }

  const id = uuid();
  const now = Date.now();

  // 写入 DashVector
  const vector = await embedding.embed(content);
  await dv.upsert(id, vector, {
    agent_id,
    user_id,
    type,
    importance,
    created_at: now,
    content,
  });

  // 写入 SQLite 备份
  stmts.insert.run(id, agent_id, user_id, type, content, importance, now);

  return { id, status: 'ok' };
});

/** 语义搜索 */
fastify.post<{ Body: SearchInput }>('/api/memory/search', async (req, reply) => {
  const { agent_id, user_id, query, limit = 10 } = req.body;

  if (!agent_id || !query) {
    return reply.status(400).send({ error: 'agent_id and query are required' });
  }

  const vector = await embedding.embed(query);
  const hits = await dv.search(vector, { agent_id, user_id }, limit);

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

/** 删除记忆（需 agent_id 校验，防止跨 Agent 删除） */
fastify.delete<{ Params: { id: string }; Querystring: { agent_id: string } }>(
  '/api/memory/:id',
  async (req, reply) => {
    const { id } = req.params;
    const { agent_id } = req.query;

    if (!agent_id) {
      return reply.status(400).send({ error: 'agent_id is required' });
    }

    const row = stmts.get.get(id) as any;
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

/** 健康检查 */
fastify.get('/api/memory/health', async () => {
  const dvStats = await dv.stats().catch(() => ({ docCount: -1 }));
  const localCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
  return {
    status: 'ok',
    dashvector_docs: dvStats.docCount,
    local_docs: localCount,
  };
});

/** 列表（按时间，支持 user_id 过滤） */
fastify.get<{ Querystring: { agent_id: string; user_id?: string; limit?: number } }>(
  '/api/memory',
  async (req, reply) => {
    const { agent_id, user_id, limit = 50 } = req.query;
    if (!agent_id) return reply.status(400).send({ error: 'agent_id required' });

    const rows = user_id
      ? stmts.listByAgentUser.all(agent_id, user_id, limit)
      : stmts.listByAgent.all(agent_id, limit);
    return { results: rows };
  }
);

// ---- 启动 ----

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Memory service listening on ${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
