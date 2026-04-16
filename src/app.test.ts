import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, MAX_LIST_LIMIT } from './app.js';

const tempDirs: string[] = [];
const API_KEY = 'test-memory-key';

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('memory service smoke flow', () => {
  it('supports save, list, search, and delete with agent isolation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-service-test-'));
    tempDirs.push(dir);

    const app = await buildApp({
      env: {
        MEMORY_MOCK: '1',
        DB_PATH: join(dir, 'memories.db'),
        MEMORY_SERVICE_API_KEY: API_KEY,
      },
    });

    try {
      const save = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          agent_id: 'hermes-admin',
          content: '用户偏好淡紫色',
          type: 'preference',
        },
        headers: { 'x-memory-api-key': API_KEY },
      });

      expect(save.statusCode).toBe(200);
      const saved = save.json<{ id: string; status: string }>();
      expect(saved.status).toBe('ok');

      const list = await app.inject({
        method: 'GET',
        url: `/api/memory?agent_id=hermes-admin&limit=${MAX_LIST_LIMIT + 999}`,
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json<{ results: Array<{ id: string }> }>().results).toHaveLength(1);

      const search = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          agent_id: 'hermes-admin',
          query: '用户偏好淡紫色',
          limit: 5,
        },
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(search.statusCode).toBe(200);
      expect(search.json<{ results: Array<{ id: string }> }>().results[0]?.id).toBe(saved.id);

      const isolatedSearchBeforeDelete = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          agent_id: 'hermes-jingwen',
          query: '用户偏好淡紫色',
          limit: 5,
        },
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(isolatedSearchBeforeDelete.statusCode).toBe(200);
      expect(isolatedSearchBeforeDelete.json<{ results: unknown[] }>().results).toHaveLength(0);

      const foreignDelete = await app.inject({
        method: 'DELETE',
        url: `/api/memory/${saved.id}?agent_id=hermes-jingwen`,
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(foreignDelete.statusCode).toBe(403);

      const ownDelete = await app.inject({
        method: 'DELETE',
        url: `/api/memory/${saved.id}?agent_id=hermes-admin`,
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(ownDelete.statusCode).toBe(200);

      const isolatedSearchAfterDelete = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          agent_id: 'hermes-jingwen',
          query: '用户偏好淡紫色',
          limit: 5,
        },
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(isolatedSearchAfterDelete.statusCode).toBe(200);
      expect(isolatedSearchAfterDelete.json<{ results: unknown[] }>().results).toHaveLength(0);

      const ownerSearchAfterDelete = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          agent_id: 'hermes-admin',
          query: '用户偏好淡紫色',
          limit: 5,
        },
        headers: { 'x-memory-api-key': API_KEY },
      });
      expect(ownerSearchAfterDelete.statusCode).toBe(200);
      expect(ownerSearchAfterDelete.json<{ results: unknown[] }>().results).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('rejects MEMORY_MOCK when production settings are present', async () => {
    await expect(
      buildApp({
        env: {
          MEMORY_MOCK: '1',
          MEMORY_SERVICE_API_KEY: API_KEY,
          DASHVECTOR_API_KEY: 'real-key-present',
        },
      })
    ).rejects.toThrow(/MEMORY_MOCK=1 is for local dev only/);
  });

  it('rejects requests without the shared API key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-service-test-'));
    tempDirs.push(dir);

    const app = await buildApp({
      env: {
        MEMORY_MOCK: '1',
        DB_PATH: join(dir, 'memories.db'),
        MEMORY_SERVICE_API_KEY: API_KEY,
      },
    });

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/health',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
