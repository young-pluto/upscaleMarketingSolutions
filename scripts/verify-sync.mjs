import { getDatabase } from '../api/_firebase-admin.js';
const db = getDatabase();
const r = async p => (await db.ref(p).once('value')).val() || {};
const CUT = Date.parse('2025-09-06T00:00:00Z');
const ts = o => Number(o.createdAt) || (o.timestamp ? Date.parse(o.timestamp) : 0) || 0;

const clients = await r('crm/clients');
const orders = await r('orders');
const leads = await r('trialCampaignSubmissions');

// 1) the reported case
const target = Object.entries(clients).find(([k,c]) => (c.handle||'').toLowerCase().includes('2rawtune'));
console.log('CLIENT 2rawtunee:', target ? JSON.stringify({key:target[0], handle:target[1].handle, name:target[1].name||'(none)', label: target[1].name || ('@'+target[1].handle)}) : 'NOT FOUND');
const nansha = Object.entries(orders).find(([k,o]) => (o.fullName||'').toLowerCase().includes('nansha'));
console.log('ORDER nansha:', nansha ? JSON.stringify({key:nansha[0], fullName:nansha[1].fullName, amount:nansha[1].amount, clientId:nansha[1].clientId||null, clientName:nansha[1].clientName??null}) : 'NOT FOUND');

// 2) clients with NO name (the empty-pill bug class)
const noName = Object.values(clients).filter(c => !c.name);
console.log('clients with no name (would have shown an empty pill):', noName.length, '→ e.g.', noName.slice(0,3).map(c=>'@'+c.handle).join(', '));

// 3) projection preview
let withOrders=0, active=0, totalRev=0;
const proj = {};
for (const [k,o] of Object.entries(orders)) {
  if (!o.clientId) continue;
  const p = proj[o.clientId] || (proj[o.clientId] = {n:0,rev:0,act:false});
  if (ts(o) && ts(o) < CUT) continue;
  p.n++; p.rev += Number(o.amount)||0;
  if (['pending','in_progress'].includes(o.serviceStatus||'pending')) p.act = true;
}
for (const [cid,p] of Object.entries(proj)) { if(!clients[cid]) { console.log('DANGLING clientId on orders:', cid); continue; } if(p.n){withOrders++; totalRev+=p.rev;} if(p.act) active++; }
console.log('projection → clients with orders:', withOrders, '| total revenue: $'+totalRev.toFixed(2), '| clients with an ACTIVE order (red blip):', active);

// 4) leads + labels
const byStatus = {};
for (const l of Object.values(leads)) { const s = l.leadStatus||'new'; byStatus[s]=(byStatus[s]||0)+1; }
console.log('leads total:', Object.keys(leads).length, 'by label:', byStatus);
process.exit(0);
