// Unify all client records into a single source of truth: crm/clients.
// DRY-RUN by default (writes nothing, prints a full plan). Pass --commit to execute.
//
//   node scripts/migrate-unify-clients.mjs            # dry run (safe)
//   node scripts/migrate-unify-clients.mjs --commit   # execute (writes to RTDB)
//
// Strategy (from real data: zero handle-overlap across tables => clean union):
//   1. legacyClients  -> crm/clients   (source=legacy)   your real relationship records
//   2. usmClients     -> crm/clients   (source=usm)       order-linking stubs; backfill email/phone from their linked orders
//   3. crm/clients (existing)          (source=crm)       kept as-is, gaps filled
//   4. orders.clientId repointed from old usm/legacy keys -> new unified keys
//   5. remaining paying customers (by email/phone) -> new crm/clients (source=order) with their orders linked
//   6. rebuild indexes: clientHandleIndex, clientEmailIndex, clientPhoneIndex
// Idempotent: skips any source record already migrated (marked via crm/migrationMap).

import { admin, getDatabase } from '../api/_firebase-admin.js';

const COMMIT = process.argv.includes('--commit');
const db = getDatabase();

// Orders before this are test data (mirrors admin.js TEST_ORDER_CUTOFF_MS).
const TEST_ORDER_CUTOFF_MS = Date.parse('2025-09-06T00:00:00Z');
function orderTs(o) { return o.createdAt || (o.timestamp ? Date.parse(o.timestamp) : 0) || 0; }
function isTestOrder(o) { return orderTs(o) < TEST_ORDER_CUTOFF_MS; }

/* ---------- helpers ---------- */
function normHandle(v) {
    return String(v || '').trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/.*$/, '').replace(/\?.*$/, '')
        .toLowerCase().trim();
}
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function normPhone(v) { return String(v || '').replace(/[^\d+]/g, '').trim(); }
function idxKey(s) { return Buffer.from(String(s).toLowerCase(), 'utf8').toString('base64url'); }

// Map admin activity + hot -> CRM status/urgent.
function statusFromLegacy(c, hasOrders) {
    if (hasOrders) return 'Client';
    const a = c.activity || 'neutral';
    if (a === 'active') return 'Active';
    if (a === 'dormant') return 'Stale';
    return 'Warm';
}
function mergeNotes(...parts) {
    return parts.map((p) => String(p || '').trim()).filter(Boolean).join('\n\n').slice(0, 2000);
}

async function read(path) {
    const snap = await db.ref(path).once('value');
    const val = snap.val() || {};
    return Object.entries(val).map(([key, v]) => ({ key, ...v }));
}

/* ---------- load ---------- */
const [orders, usmClients, legacyClients, crmClients, channels] = await Promise.all([
    read('orders'), read('usmClients'), read('legacyClients'), read('crm/clients'), read('channels')
]);

// channel name -> channels/ key (for mapping crm's name-based channel to a ref)
const channelKeyByName = new Map(channels.map((c) => [String(c.name || '').toLowerCase(), c.key]));

// orders grouped by the client they're already linked to (old keys)
const ordersByOldClientId = new Map();
for (const o of orders) {
    if (o.clientId) {
        if (!ordersByOldClientId.has(o.clientId)) ordersByOldClientId.set(o.clientId, []);
        ordersByOldClientId.get(o.clientId).push(o);
    }
}

// The unified set we are BUILDING. Each entry: { key(existing crm)|null, record, fromSource, fromKey, ordersToLink[] }
const plan = [];
const handleIndex = new Map();   // handleKey -> planIndex
const emailIndex = new Map();    // emailKey  -> planIndex
const phoneIndex = new Map();    // phoneKey  -> planIndex

function registerIndexes(i, rec) {
    if (rec.handleKey) handleIndex.set(rec.handleKey, i);
    if (rec.emailKey) emailIndex.set(rec.emailKey, i);
    if (rec.phoneKey) phoneIndex.set(rec.phoneKey, i);
}

const now = Date.now();

/* ---------- 1. existing crm/clients kept as canonical ---------- */
for (const c of crmClients) {
    const rec = {
        ...c,
        name: c.name || '',
        slug: c.slug || '',
        email: c.email || '', emailKey: normEmail(c.email),
        phone: c.phone || '', phoneKey: normPhone(c.phone),
        channel: c.channel || (channelKeyByName.get('') || ''),
        activity: c.activity || 'neutral',
        urgent: !!c.urgent,
        source: c.source || 'crm', sourceKey: c.key
    };
    delete rec.key;
    const i = plan.length;
    plan.push({ key: c.key, record: rec, fromSource: 'crm', fromKey: c.key, ordersToLink: [] });
    registerIndexes(i, rec);
}

/* ---------- 2. legacyClients -> unified ---------- */
for (const c of legacyClients) {
    const handleKey = normHandle(c.instagram);
    const linkedOrders = ordersByOldClientId.get(c.key) || [];
    const rec = {
        handle: handleKey, handleKey,
        name: c.name || '', slug: '',
        email: '', emailKey: '', phone: '', phoneKey: '',
        niche: '',
        status: statusFromLegacy(c, linkedOrders.length > 0),
        activity: c.activity || 'neutral',
        needsReply: false,
        urgent: !!c.hot,
        note: mergeNotes(c.notes),
        highlights: [], history: [{ at: c.createdAt || now, text: 'Imported from Old Clients' }],
        followUpAt: null, followUpHasTime: false,
        channel: c.channel || '',
        lastContactedAt: c.lastContacted || null,
        archived: false,
        source: 'legacy', sourceKey: c.key,
        createdAt: c.createdAt || now, updatedAt: now,
        createdBy: 'migration', updatedBy: 'migration'
    };
    const i = plan.length;
    plan.push({ key: null, record: rec, fromSource: 'legacy', fromKey: c.key, ordersToLink: linkedOrders });
    registerIndexes(i, rec);
}

/* ---------- 3. usmClients -> unified (backfill email/phone from linked orders) ---------- */
for (const c of usmClients) {
    const handleKey = normHandle(c.instagram);
    const linkedOrders = ordersByOldClientId.get(c.key) || [];
    // backfill contact from the most recent linked order
    const ref = [...linkedOrders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || {};
    const email = ref.email || '';
    const phone = ref.phone || '';
    const rec = {
        handle: handleKey, handleKey,
        name: c.name || ref.fullName || '', slug: c.slug || '',
        email, emailKey: normEmail(email), phone, phoneKey: normPhone(phone),
        niche: '',
        status: linkedOrders.length ? 'Client' : (c.activity === 'active' ? 'Active' : c.activity === 'dormant' ? 'Stale' : 'Warm'),
        activity: c.activity || 'neutral',
        needsReply: false, urgent: false,
        note: mergeNotes(c.notes),
        highlights: [], history: [{ at: c.createdAt || now, text: 'Imported from Clients' }],
        followUpAt: null, followUpHasTime: false,
        channel: c.channel || '',
        lastContactedAt: null,
        archived: false,
        source: 'usm', sourceKey: c.key,
        createdAt: c.createdAt || now, updatedAt: now,
        createdBy: 'migration', updatedBy: 'migration'
    };
    const i = plan.length;
    plan.push({ key: null, record: rec, fromSource: 'usm', fromKey: c.key, ordersToLink: linkedOrders });
    registerIndexes(i, rec);
}

/* ---------- 4 & 5. remaining paying customers -> unified (create-from-order + auto-link) ---------- */
// group REAL (non-test) orders by customer key (email preferred, else phone).
// Test orders (pre-cutoff) never manufacture a client; if already manually linked
// they keep that link via the ordersByOldClientId path above.
const custGroups = new Map();
for (const o of orders) {
    if (isTestOrder(o)) continue;
    const ek = normEmail(o.email);
    const pk = normPhone(o.phone);
    const key = ek || pk;
    if (!key) continue;
    if (!custGroups.has(key)) custGroups.set(key, { ek, pk, orders: [] });
    custGroups.get(key).orders.push(o);
}

let createdFromOrders = 0;
let linkedToExisting = 0;
for (const [key, g] of custGroups) {
    // does this customer already map to a planned client (via email or phone)?
    let i;
    if (g.ek && emailIndex.has(g.ek)) i = emailIndex.get(g.ek);
    else if (g.pk && phoneIndex.has(g.pk)) i = phoneIndex.get(g.pk);
    if (i != null) {
        // link these orders to that existing planned client; backfill contact if missing
        plan[i].ordersToLink.push(...g.orders.filter((o) => !plan[i].ordersToLink.includes(o)));
        const rec = plan[i].record;
        if (!rec.emailKey && g.ek) { rec.email = g.orders[0].email || ''; rec.emailKey = g.ek; emailIndex.set(g.ek, i); }
        if (!rec.phoneKey && g.pk) { rec.phone = g.orders[0].phone || ''; rec.phoneKey = g.pk; phoneIndex.set(g.pk, i); }
        linkedToExisting++;
        continue;
    }
    // create a new client from this paying customer
    const ref = [...g.orders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    const rec = {
        handle: '', handleKey: '',
        name: ref.fullName || ref.email || 'Customer', slug: '',
        email: ref.email || '', emailKey: g.ek, phone: ref.phone || '', phoneKey: g.pk,
        niche: '',
        status: 'Client', activity: 'active',
        needsReply: false, urgent: false,
        note: '',
        highlights: [], history: [{ at: ref.createdAt || now, text: 'Created from order' }],
        followUpAt: null, followUpHasTime: false,
        channel: '',
        lastContactedAt: ref.createdAt || null,
        archived: false,
        source: 'order', sourceKey: key,
        createdAt: ref.createdAt || now, updatedAt: now,
        createdBy: 'migration', updatedBy: 'migration'
    };
    const idx = plan.length;
    plan.push({ key: null, record: rec, fromSource: 'order', fromKey: key, ordersToLink: [...g.orders] });
    registerIndexes(idx, rec);
    createdFromOrders++;
}

/* ---------- REPORT ---------- */
const bySource = plan.reduce((m, p) => { m[p.fromSource] = (m[p.fromSource] || 0) + 1; return m; }, {});
const totalOrdersLinked = plan.reduce((n, p) => n + p.ordersToLink.length, 0);
const unlinkedOrders = orders.filter((o) => !normEmail(o.email) && !normPhone(o.phone));

const testOrders = orders.filter(isTestOrder).length;
console.log('\n========== UNIFICATION PLAN (' + (COMMIT ? 'COMMIT' : 'DRY RUN') + ') ==========');
console.log('Orders:', orders.length, '| real:', orders.length - testOrders, '| test (pre-2025-09-06, excluded from client creation):', testOrders);
console.log('Unified clients to exist:', plan.length, 'by source:', bySource);
console.log('  (existing crm kept:', crmClients.length, '| legacy imported:', legacyClients.length, '| usm imported:', usmClients.length, '| created from orders:', createdFromOrders, '| order-groups linked to existing client:', linkedToExisting, ')');
console.log('Orders linked to a unified client:', totalOrdersLinked, 'of', orders.length);
console.log('Orders with NO email/phone (stay unlinked):', unlinkedOrders.length);
console.log('\nSample created-from-order client:', JSON.stringify(plan.find((p) => p.fromSource === 'order')?.record, null, 0));
console.log('Sample legacy client:', JSON.stringify(plan.find((p) => p.fromSource === 'legacy')?.record, null, 0));

if (!COMMIT) {
    console.log('\nDRY RUN complete. No data written. Re-run with --commit to execute.');
    process.exit(0);
}

/* ---------- COMMIT ---------- */
console.log('\nWriting to RTDB...');
// backup affected nodes first
const backup = { orders, usmClients, legacyClients, crmClients, channels, at: now };
await db.ref('crm/_migrationBackup/' + now).set(backup);
console.log('Backup saved to crm/_migrationBackup/' + now);

const updates = {};
const oldKeyToNewKey = new Map();

for (const p of plan) {
    let key = p.key;
    if (!key) {
        key = db.ref('crm/clients').push().key;
    }
    updates['crm/clients/' + key] = p.record;
    if (p.fromKey) oldKeyToNewKey.set(p.fromKey, key);
    // indexes
    if (p.record.handleKey) updates['crm/clientHandleIndex/' + idxKey(p.record.handleKey)] = { clientKey: key, handleKey: p.record.handleKey };
    if (p.record.emailKey) updates['crm/clientEmailIndex/' + idxKey(p.record.emailKey)] = { clientKey: key };
    if (p.record.phoneKey) updates['crm/clientPhoneIndex/' + idxKey(p.record.phoneKey)] = { clientKey: key };
    // link orders
    for (const o of p.ordersToLink) {
        updates['orders/' + o.key + '/clientId'] = key;
        updates['orders/' + o.key + '/clientName'] = p.record.name || '';
        updates['orders/' + o.key + '/clientSlug'] = p.record.slug || '';
    }
}

await db.ref().update(updates);
console.log('Wrote', Object.keys(updates).length, 'paths.');
console.log('Old legacy/usm nodes left intact (not deleted). Remove them manually after verifying.');
process.exit(0);
