import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync=promisify(execFile);

test('SQLite to PostgreSQL importer is read-only and safely rerunnable', async()=>{
  const databaseUrl=process.env.DATABASE_MIGRATION_URL||process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL is required for the migration drill.');
  const tempDir=await mkdtemp(path.join(tmpdir(),'syj-hcm-migration-'));
  const sourcePath=path.join(tempDir,'source.db');
  const organizationId=`migration-drill-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const source=new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);');
  source.prepare('INSERT INTO organizations (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(organizationId,'Migration Drill','migration-drill','active','2026-10-20T00:00:00.000Z','2026-10-20T00:00:00.000Z');
  source.close();

  const run=async()=>execFileAsync(process.execPath,['--import','tsx','scripts/migrate-sqlite-to-postgres.ts'],{env:{...process.env,SQLITE_SOURCE_PATH:sourcePath,SQLITE_IMPORT_TABLES:'organizations',DATABASE_MIGRATION_URL:databaseUrl}});
  try{
    const first=await run();
    const firstReport=JSON.parse(first.stdout) as {report:Array<{table:string;source:number;inserted:number;skipped:number;rejected:number}>};
    assert.deepEqual(firstReport.report,[{table:'organizations',source:1,inserted:1,skipped:0,rejected:0,errors:[]}]);

    const second=await run();
    const secondReport=JSON.parse(second.stdout) as {report:Array<{table:string;source:number;inserted:number;skipped:number;rejected:number}>};
    assert.deepEqual(secondReport.report,[{table:'organizations',source:1,inserted:0,skipped:1,rejected:0,errors:[]}]);

    const verify=postgres(databaseUrl,{max:1});
    try{
      const rows=await verify<{id:string;name:string;slug:string;status:string}[]>`SELECT id,name,slug,status FROM organizations WHERE id=${organizationId}`;
      assert.deepEqual(rows,[{id:organizationId,name:'Migration Drill',slug:'migration-drill',status:'active'}]);
    }finally{await verify`DELETE FROM organizations WHERE id=${organizationId}`;await verify.end({timeout:5});}
  }finally{
    await rm(tempDir,{recursive:true,force:true});
  }
});
