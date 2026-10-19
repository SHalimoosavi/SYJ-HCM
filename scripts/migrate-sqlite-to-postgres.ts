import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = process.env.SQLITE_SOURCE_PATH;
const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
const dryRun = process.argv.includes('--dry-run');

if (!sourcePath) throw new Error('SQLITE_SOURCE_PATH must point to the immutable source SQLite database.');
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be configured.');
const resolvedSource = path.resolve(sourcePath);
if (!fs.existsSync(resolvedSource)) throw new Error(`SQLite source database not found: ${resolvedSource}`);

const allTables = [
  'organizations','departments','employees','users','organization_settings','sessions','login_rate_limits',
  'platform_administrators','platform_audit_logs','leave_types','leave_balances','job_requisitions',
  'candidates','applications','application_history','recruitment_stages','interview_rounds','interviews',
  'interview_participants','interview_feedback','interview_feedback_corrections','interview_decisions',
  'candidate_notes','candidate_activities','leave_requests','attendance_records','audit_logs','job_publications',
  'public_application_rate_limits','offers','offer_history','offer_response_rate_limits','candidate_documents'
] as const;
const requestedTables: string[] | undefined = process.env.SQLITE_IMPORT_TABLES?.split(',').map((value)=>value.trim()).filter((value): value is string=>value.length>0);
const tables:string[]=requestedTables?.length ? requestedTables : [...allTables];
const invalidTables=tables.filter((table)=>!allTables.includes(table as typeof allTables[number]));
if(invalidTables.length)throw new Error(`Unsupported import table(s): ${invalidTables.join(', ')}`);

type SourceRow = Record<string, unknown>;
type TargetColumn = { column_name:string; data_type:string; udt_name:string; is_nullable:string };

type MigrationValue = string | number | boolean | null;

function quoteIdentifier(value:string){return `"${value.replaceAll('"','""')}"`;}
function convertValue(value:unknown,column:TargetColumn):MigrationValue{
  if(value===null||value===undefined)return null;
  if(column.data_type==='boolean'){
    if(typeof value==='boolean')return value;
    if(typeof value==='number')return value!==0;
    return ['1','true','t','yes'].includes(String(value).trim().toLowerCase());
  }
  if(column.data_type==='timestamp with time zone'||column.data_type==='timestamp without time zone'){
    const text=String(value).trim();
    if(!text)return null;
    const parsed=new Date(text);
    if(Number.isNaN(parsed.getTime()))throw new Error(`Invalid timestamp ${text} for ${column.column_name}`);
    return parsed.toISOString();
  }
  if(['integer','bigint','smallint','numeric','double precision','real'].includes(column.data_type)){
    const number=Number(value);
    if(!Number.isFinite(number))throw new Error(`Invalid numeric value for ${column.column_name}: ${String(value)}`);
    return number;
  }
  return String(value);
}

async function main(){
  const source=new DatabaseSync(resolvedSource,{readOnly:true});
  const client=postgres(databaseUrl,{max:1});
  const report:{table:string;source:number;inserted:number;skipped:number;rejected:number;errors:string[]}[]=[];
  try{
    const targetTables=await client<{table_name:string}[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
    `;
    const targetSet=new Set(targetTables.map((x)=>x.table_name));
    const sourceTables=new Set((source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map((x)=>x.name));
    const missingSource=tables.filter((table)=>!sourceTables.has(table));
    const missingTarget=tables.filter((table)=>!targetSet.has(table));
    if(missingSource.length)throw new Error(`Source schema is missing required tables: ${missingSource.join(', ')}`);
    if(missingTarget.length)throw new Error(`Destination schema is missing required tables: ${missingTarget.join(', ')}`);

    const targetColumns=new Map<string,TargetColumn[]>();
    for(const table of tables){
      const columns=await client<TargetColumn[]>`
        SELECT column_name,data_type,udt_name,is_nullable
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=${table}
        ORDER BY ordinal_position
      `;
      targetColumns.set(table,columns);
    }

    if(dryRun){
      for(const table of tables){
        const count=Number((source.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as {count:number}).count);
        report.push({table,source:count,inserted:0,skipped:0,rejected:0,errors:[]});
      }
      console.log(JSON.stringify({dryRun:true,source:resolvedSource,report},null,2));
      return;
    }

    await client.begin(async(tx)=>{
      for(const table of tables){
        const entry={table,source:0,inserted:0,skipped:0,rejected:0,errors:[] as string[]};
        report.push(entry);
        const columns=targetColumns.get(table) ?? [];
        const sourceRows=source.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as SourceRow[];
        entry.source=sourceRows.length;
        if(!sourceRows.length)continue;
        const firstRow=sourceRows[0];
        if(!firstRow){entry.skipped=sourceRows.length;continue;}
        const sourceColumnNames=Object.keys(firstRow);
        const usable=columns.filter((column)=>sourceColumnNames.includes(column.column_name));
        if(!usable.length){entry.skipped=sourceRows.length;continue;}
        const names=usable.map((column)=>quoteIdentifier(column.column_name)).join(',');
        for(const row of sourceRows){
          try{
            const values=usable.map((column)=>convertValue(row[column.column_name],column));
            const result=await tx`
              INSERT INTO ${tx.unsafe(quoteIdentifier(table))} (${tx.unsafe(names)})
              VALUES ${tx(values)}
              ON CONFLICT DO NOTHING
              RETURNING 1
            `;
            if(result.length)entry.inserted++;else entry.skipped++;
          }catch(error){
            entry.rejected++;
            entry.errors.push(error instanceof Error?error.message:String(error));
            if(entry.errors.length>=20)break;
          }
        }
        if(entry.rejected>0)throw new Error(`Migration aborted on ${table}: ${entry.rejected} rejected rows. ${entry.errors.slice(0,3).join(' | ')}`);
      }
    });
    console.log(JSON.stringify({dryRun:false,source:resolvedSource,report},null,2));
  }finally{
    source.close();
    await client.end({timeout:5});
  }
}

main().catch((error)=>{console.error(error instanceof Error?error.stack:error);process.exitCode=1;});
