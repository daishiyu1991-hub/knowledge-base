/**
 * Memory Service entrypoint.
 */

import 'dotenv/config';
import { startApp } from './app.js';

try {
  await startApp();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: 'fatal', msg: 'Failed to start memory service', err: message }));
  process.exit(1);
}
