import fs from 'node:fs';
import path from 'node:path';

const roots=['src','scripts','tests'];
const extensions=new Set(['.ts','.tsx','.js','.mjs','.cjs']);
const lintFile=path.resolve('scripts/lint.ts');
const forbidden=[
  {pattern:/@ts-ignore\b/,message:'@ts-ignore is forbidden'},
  {pattern:/@ts-expect-error\b/,message:'@ts-expect-error is forbidden'},
  {pattern:/\bas\s+any\b/,message:'unsafe `as any` cast is forbidden'},
  {pattern:/<<<<<<<|=======|>>>>>>>/,message:'merge conflict marker detected'},
];
const files:string[]=[];
function walk(dir:string){
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(!['node_modules','.next','.git'].includes(entry.name))walk(full);continue;}
    if(extensions.has(path.extname(entry.name)))files.push(full);
  }
}
for(const root of roots)walk(root);
const errors:string[]=[];
for(const file of files){
  if(path.resolve(file)===lintFile)continue;
  const text=fs.readFileSync(file,'utf8');
  for(const rule of forbidden)if(rule.pattern.test(text))errors.push(`${file}: ${rule.message}`);
}
if(errors.length){for(const error of errors)console.error(error);process.exitCode=1;}else{console.log(`Lint passed: ${files.length-1} source/test/script files checked.`);}
