// READ-ONLY inspection of the live RTDB. Writes nothing.
// Purpose: ground the client-unification plan in real data (counts, quality, overlap).
import { getDatabase } from '../api/_firebase-admin.js';

function normHandle(v) {
    return String(v || '')
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/.*$/, '')
        .replace(/\?.*$/, '')
        .toLowerCase()
        .trim();
}

const db = getDatabase();

async function read(path) {
    const snap = await db.ref(path).once('value');
    const val = snap.val() || {};
    return Object.entries(val).map(([key, v]) => ({ key, ...v }));
}

function summarizeField(rows, field) {
    const filled = rows.filter((r) => r[field] != null && String(r[field]).trim() !== '').length;
    return `${filled}/${rows.length}`;
}

const [orders, usmClients, legacyClients, crmClients, channels, trials] = await Promise.all([
    read('orders'),
    read('usmClients'),
    read('legacyClients'),
    read('crm/clients'),
    read('channels'),
    read('trialCampaignSubmissions')
]);

console.log('\n================= NODE COUNTS =================');
console.log({ orders: orders.length, usmClients: usmClients.length, legacyClients: legacyClients.length, crmClients: crmClients.length, channels: channels.length, trials: trials.length });

console.log('\n================= FIELD FILL (filled/total) =================');
console.log('orders:', { fullName: summarizeField(orders, 'fullName'), email: summarizeField(orders, 'email'), phone: summarizeField(orders, 'phone'), clientId: summarizeField(orders, 'clientId'), amount: summarizeField(orders, 'amount') });
console.log('usmClients:', { name: summarizeField(usmClients, 'name'), instagram: summarizeField(usmClients, 'instagram'), channel: summarizeField(usmClients, 'channel'), notes: summarizeField(usmClients, 'notes'), slug: summarizeField(usmClients, 'slug') });
console.log('legacyClients:', { name: summarizeField(legacyClients, 'name'), instagram: summarizeField(legacyClients, 'instagram'), channel: summarizeField(legacyClients, 'channel'), notes: summarizeField(legacyClients, 'notes') });
console.log('crmClients:', { handle: summarizeField(crmClients, 'handle'), niche: summarizeField(crmClients, 'niche'), note: summarizeField(crmClients, 'note'), channel: summarizeField(crmClients, 'channel') });

// Handle overlap analysis
const usmH = new Map(); usmClients.forEach((c) => { const h = normHandle(c.instagram); if (h) usmH.set(h, c); });
const legH = new Map(); legacyClients.forEach((c) => { const h = normHandle(c.instagram); if (h) legH.set(h, c); });
const crmH = new Map(); crmClients.forEach((c) => { const h = normHandle(c.handle); if (h) crmH.set(h, c); });

const allHandles = new Set([...usmH.keys(), ...legH.keys(), ...crmH.keys()]);
let inAll3 = 0, usmAndCrm = 0, legAndCrm = 0, usmAndLeg = 0;
for (const h of allHandles) {
    const inU = usmH.has(h), inL = legH.has(h), inC = crmH.has(h);
    if (inU && inL && inC) inAll3++;
    if (inU && inC) usmAndCrm++;
    if (inL && inC) legAndCrm++;
    if (inU && inL) usmAndLeg++;
}
console.log('\n================= HANDLE OVERLAP =================');
console.log({ withHandle: { usm: usmH.size, legacy: legH.size, crm: crmH.size }, uniqueHandlesTotal: allHandles.size, overlaps: { usmAndCrm, legAndCrm, usmAndLeg, inAll3 } });
console.log('usmClients WITHOUT a handle:', usmClients.length - usmH.size);
console.log('legacyClients WITHOUT a handle:', legacyClients.length - legH.size);

// Order → client linking reality
const linked = orders.filter((o) => o.clientId).length;
const withEmail = orders.filter((o) => (o.email || '').trim()).length;
const withPhone = orders.filter((o) => (o.phone || '').trim()).length;
// how many DISTINCT customers by email/phone
const custKeys = new Set();
orders.forEach((o) => { const k = (o.email || '').trim().toLowerCase() || (o.phone || '').trim(); if (k) custKeys.add(k); });
console.log('\n================= ORDERS → CUSTOMER =================');
console.log({ totalOrders: orders.length, linkedToClient: linked, withEmail, withPhone, distinctCustomersByEmailOrPhone: custKeys.size });

// channel usage
console.log('\n================= CHANNELS =================');
console.log('channel names:', channels.map((c) => c.name));

// Sample one of each for shape sanity
console.log('\n================= SAMPLES =================');
console.log('sample crmClient:', JSON.stringify(crmClients[0] || null));
console.log('sample usmClient:', JSON.stringify(usmClients[0] || null));
console.log('sample legacyClient:', JSON.stringify(legacyClients[0] || null));

process.exit(0);
