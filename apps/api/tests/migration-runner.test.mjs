import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const migrationDir=path.resolve(here,'../db/migrations');

test('all forward migrations are numbered and paired with rollback',async()=>{const files=await fs.readdir(migrationDir);const forward=files.filter(x=>/^\d+_.+\.sql$/.test(x)&&!x.endsWith('.down.sql')).sort();assert.ok(forward.length>=31);for(const name of forward){const down=name.replace(/\.sql$/,'.down.sql');assert.ok(files.includes(down),`missing rollback for ${name}`);}});

test('forward migrations have unique numeric prefixes',async()=>{const files=(await fs.readdir(migrationDir)).filter(x=>/^\d+_.+\.sql$/.test(x)&&!x.endsWith('.down.sql'));const prefixes=files.map(x=>x.split('_')[0]);assert.equal(new Set(prefixes).size,prefixes.length);});
