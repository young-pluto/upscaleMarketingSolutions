import { getDatabase } from '../api/_firebase-admin.js';
const db = getDatabase();
const r = async p => (await db.ref(p).once('value')).val() || {};
const clients = await r('crm/clients');
const orders = await r('orders');
const emailIdx = await r('crm/clientEmailIndex');
const phoneIdx = await r('crm/clientPhoneIndex');
const handleIdx = await r('crm/clientHandleIndex');
const clientKeys = new Set(Object.keys(clients));
const bySource = {};
for (const c of Object.values(clients)) bySource[c.source||'?']=(bySource[c.source||'?']||0)+1;
let linked=0, danglers=0;
for (const o of Object.values(orders)) { if(o.clientId){ linked++; if(!clientKeys.has(o.clientId)) danglers++; } }
console.log('crm/clients count:', clientKeys.size, 'by source:', bySource);
console.log('orders total:', Object.keys(orders).length, '| linked:', linked, '| dangling clientId (BAD if >0):', danglers);
console.log('indexes — email:', Object.keys(emailIdx).length, 'phone:', Object.keys(phoneIdx).length, 'handle:', Object.keys(handleIdx).length);
console.log('backups present:', Object.keys(await r('crm/_migrationBackup')).length);
process.exit(0);
