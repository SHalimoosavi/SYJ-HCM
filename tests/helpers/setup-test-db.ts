import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const tempPath = path.join(os.tmpdir(), `syj-hcm-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = tempPath;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-only-used-in-tests-not-real';

const setupClient = new DatabaseSync(tempPath);
setupClient.exec('PRAGMA foreign_keys = ON;');
const sql = fs.readFileSync(path.resolve(currentDir, '../../drizzle/0000_init.sql'), 'utf-8');
setupClient.exec(sql);
setupClient.close();

// Import side effect only - importing src/db/client after this point will
// pick up the DATABASE_PATH we just set and connect to this temp file,
// which already has the real schema applied.
