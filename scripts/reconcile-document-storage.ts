import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../src/db/client';
import { candidateDocuments } from '../src/db/schema';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await walk(full)); else out.push(full);
  }
  return out;
}

async function main() {
  const root=path.resolve(process.env.DOCUMENT_STORAGE_PATH || './data/candidate-documents');
  const rows=await db.select({storageKey:candidateDocuments.storageKey}).from(candidateDocuments);
  const known=new Set(rows.map((row)=>path.resolve(root,row.storageKey)));
  const files=await walk(root).catch(()=>[] as string[]);
  const orphans=files.filter((file)=>!file.endsWith('.tmp')&&!known.has(path.resolve(file)));
  console.log(`storage files=${files.length} db references=${known.size} orphan candidates=${orphans.length}`);
  for(const file of orphans) console.log(`ORPHAN ${path.relative(root,file)}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
