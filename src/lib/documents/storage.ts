import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type StorageMetadata = { size: number };
export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<StorageMetadata>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  metadata(key: string): Promise<StorageMetadata>;
}

function rootPath(): string {
  return path.resolve(process.env.DOCUMENT_STORAGE_PATH || './data/storage');
}

function assertKey(key: string): void {
  if (!/^documents\/[a-f0-9]{32}\/[a-f0-9]{32}$/.test(key)) throw new Error('Invalid storage key.');
}

function resolveKey(key: string): string {
  assertKey(key);
  const root = rootPath();
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Storage path escape rejected.');
  return resolved;
}

export class LocalDocumentStorage implements DocumentStorage {
  async put(key: string, data: Buffer): Promise<StorageMetadata> {
    const target = resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    try {
      await fs.writeFile(temp, data, { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, target);
      return { size: data.length };
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  async get(key: string): Promise<Buffer> { return fs.readFile(resolveKey(key)); }
  async delete(key: string): Promise<void> { await fs.rm(resolveKey(key), { force: true }); }
  async exists(key: string): Promise<boolean> { try { await fs.access(resolveKey(key)); return true; } catch { return false; } }
  async metadata(key: string): Promise<StorageMetadata> { const stat = await fs.stat(resolveKey(key)); return { size: stat.size }; }
}

export function getDocumentStorage(): DocumentStorage { return new LocalDocumentStorage(); }
export function makeStorageKey(_documentId: string): string { return `documents/${randomBytes(16).toString('hex')}/${randomBytes(16).toString('hex')}`; }
