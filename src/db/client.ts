import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import * as schema from './schema';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DATABASE_PATH || './data/syj-hcm.db';
const resolvedPath = path.resolve(process.cwd(), dbPath);

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const client = new DatabaseSync(resolvedPath);
client.exec('PRAGMA journal_mode = WAL;');
client.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle({ client, schema });
export type Db = typeof db;
