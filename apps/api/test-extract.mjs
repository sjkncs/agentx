import { extractTableReferences } from './src/notebook-dashboard/federation-engine.ts';
const sql = `SELECT * FROM orders WHERE status = 'pending'`;
console.log('SQL:', sql);
const r = extractTableReferences(sql);
console.log('Result:', JSON.stringify(r));
console.log('Length:', r.length);
