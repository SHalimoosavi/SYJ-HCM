import fs from 'node:fs/promises';
import path from 'node:path';
import { sqlite } from '../src/db/client';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await walk(full)); else out.push(full);
  }
  return out;
}

async function main() {
  const root=path.resolve(process.env.DOCUMENT_STORAGE_PATH || './data/storage');
  const rows=sqlite.prepare('SELECT storage_key FROM candidate_documents').all() as Array<{storage_key:string}>;
  const known=new Set(rows.map(r=>path.resolve(root,r.storage_key)));
  const files=await walk(root).catch(()=>[] as string[]);
  const orphans=files.filter(f=>!f.endsWith('.tmp')&&!known.has(path.resolve(f)));
  console.log(`storage files=${files.length} db references=${known.size} orphan candidates=${orphans.length}`);
  for(const file of orphans) console.log(`ORPHAN ${path.relative(root,file)}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
