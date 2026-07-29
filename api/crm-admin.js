import { admin, getDatabase } from './_firebase-admin.js';

// CRM — Instagram client operating system.
// Single admin endpoint (mirrors lead-outreach-admin.js): Firebase ID token auth,
// namespaced under crm/. GET loads everything; POST creates; PATCH updates; DELETE removes.

const COLLECTIONS = {
    clients: 'crm/clients'
};

const STATUSES = ['Lead', 'Warm', 'Active', 'Client', 'VIP', 'Stale', 'Dead'];

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

function sanitizeString(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizeHandle(value) {
    return sanitizeString(value, 120)
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/.*$/, '')
        .replace(/\?.*$/, '')
        .trim();
}

function handleIndexKey(handleKey) {
    return Buffer.from(String(handleKey).toLowerCase(), 'utf8').toString('base64url');
}

function normalizeEmail(value) {
    return sanitizeString(value, 200).toLowerCase();
}

function normalizePhone(value) {
    return sanitizeString(value, 40).replace(/[^\d+]/g, '');
}

const ACTIVITIES = ['active', 'neutral', 'dormant'];
const SOURCES = ['manual', 'crm', 'legacy', 'usm', 'order', 'trial', 'lead-outreach'];

// Leads and clients are the same record with the same operations; `kind` is the
// one field that keeps them apart in the UI. Derived for records written before
// this field existed. (Converting a lead is a deliberate flip of this field —
// nothing auto-converts.)
const KINDS = ['lead', 'client'];
function deriveKind(c) {
    if (KINDS.includes(c.kind)) return c.kind;
    return (c.source === 'trial' || c.status === 'Lead') ? 'lead' : 'client';
}

function clampStatus(value) {
    return STATUSES.includes(value) ? value : 'Lead';
}

function sanitizeHighlights(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 40)
        .map((h) => ({
            text: sanitizeString(h && h.text, 60),
            pinned: !!(h && h.pinned)
        }))
        .filter((h) => h.text);
}

function sanitizeHistory(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 200)
        .map((e) => ({
            at: Number(e && e.at) || 0,
            text: sanitizeString(e && e.text, 200)
        }))
        .filter((e) => e.text);
}

function snapshotToArray(snapshot) {
    const items = [];
    if (!snapshot.exists()) return items;
    snapshot.forEach((child) => {
        items.push({ firebaseKey: child.key, ...child.val() });
    });
    return items;
}

async function requireFirebaseUser(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
        const error = new Error('Missing Firebase auth token');
        error.statusCode = 401;
        throw error;
    }
    try {
        return await admin.auth().verifyIdToken(token);
    } catch (error) {
        const authError = new Error('Invalid Firebase auth token');
        authError.statusCode = 401;
        throw authError;
    }
}

function normalizeUpdates(updates, user) {
    const normalized = {};

    if (Object.prototype.hasOwnProperty.call(updates, 'handle')) {
        const handle = normalizeHandle(updates.handle);
        if (handle) {
            normalized.handle = handle;
            normalized.handleKey = handle.toLowerCase();
        }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'niche')) {
        normalized.niche = sanitizeString(updates.niche, 120);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'channel')) {
        normalized.channel = sanitizeString(updates.channel, 120);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
        normalized.name = sanitizeString(updates.name, 160);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'slug')) {
        normalized.slug = sanitizeString(updates.slug, 160).toLowerCase();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
        const email = sanitizeString(updates.email, 200);
        normalized.email = email;
        normalized.emailKey = normalizeEmail(email);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'phone')) {
        const phone = sanitizeString(updates.phone, 40);
        normalized.phone = phone;
        normalized.phoneKey = normalizePhone(phone);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'activity')) {
        normalized.activity = ACTIVITIES.includes(updates.activity) ? updates.activity : 'neutral';
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'urgent')) {
        normalized.urgent = !!updates.urgent;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'source')) {
        normalized.source = SOURCES.includes(updates.source) ? updates.source : 'manual';
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'kind')) {
        normalized.kind = KINDS.includes(updates.kind) ? updates.kind : 'client';
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        normalized.status = clampStatus(updates.status);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'note')) {
        normalized.note = sanitizeString(updates.note, 2000);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'needsReply')) {
        normalized.needsReply = !!updates.needsReply;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'archived')) {
        normalized.archived = !!updates.archived;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'followUpAt')) {
        normalized.followUpAt = updates.followUpAt == null ? null : (Number(updates.followUpAt) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'followUpHasTime')) {
        normalized.followUpHasTime = !!updates.followUpHasTime;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'lastContactedAt')) {
        normalized.lastContactedAt = updates.lastContactedAt == null ? null : (Number(updates.lastContactedAt) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'highlights')) {
        normalized.highlights = sanitizeHighlights(updates.highlights);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'history')) {
        normalized.history = sanitizeHistory(updates.history);
    }

    normalized.updatedAt = admin.database.ServerValue.TIMESTAMP;
    normalized.updatedBy = user.email || user.uid || '';
    return normalized;
}

// Orders before this are test data (mirrors admin.js TEST_ORDER_CUTOFF_MS).
const TEST_ORDER_CUTOFF_MS = Date.parse('2025-09-06T00:00:00Z');

// "Active" means work is actually underway. Deliberately NOT 'pending' — almost
// every paid order sits at pending, so counting it made the indicator meaningless.
const ACTIVE_ORDER_STATUSES = ['in_progress'];

function orderTs(o) {
    return Number(o.createdAt) || (o.timestamp ? Date.parse(o.timestamp) : 0) || 0;
}

// The client record is the single source of truth: every order assigned to a
// client is mirrored onto the client itself, along with the rollups both apps
// render (orderCount / revenue / lastOrderAt / hasActiveOrder). `orders/` stays
// the raw transaction log that checkout writes into; this projects it onto the
// owning client so no reader needs a second lookup.
function projectOrder(o, key) {
    return {
        orderKey: key,
        orderID: o.orderID || '',
        amount: Number(o.amount) || 0,
        currency: o.currency || 'USD',
        serviceStatus: o.serviceStatus || 'pending',
        youtubeLink: o.youtubeLink || '',
        viewsStart: o.viewsStart == null ? null : Number(o.viewsStart),
        viewsEnd: o.viewsEnd == null ? null : Number(o.viewsEnd),
        commentsGiven: !!o.commentsGiven,
        likesGiven: !!o.likesGiven,
        adminNotes: o.adminNotes || '',
        paypalTransactionId: o.paypalTransactionId || '',
        at: orderTs(o),
        isTest: orderTs(o) > 0 && orderTs(o) < TEST_ORDER_CUTOFF_MS
    };
}

// Stable digest of a client's embedded orders, independent of key order, so the
// self-heal only writes when something actually changed.
function ordersFingerprint(map) {
    return Object.keys(map || {}).sort().map((k) => {
        const o = map[k] || {};
        return [k, o.amount, o.serviceStatus, o.viewsStart, o.viewsEnd,
            o.commentsGiven ? 1 : 0, o.likesGiven ? 1 : 0, o.at, o.youtubeLink, o.adminNotes, o.orderID].join('|');
    }).join(';');
}

function buildProjections(ordersSnap) {
    const byClient = {};
    if (!ordersSnap.exists()) return byClient;
    ordersSnap.forEach((child) => {
        const o = child.val() || {};
        if (!o.clientId) return;
        const p = projectOrder(o, child.key);
        const bucket = byClient[o.clientId] || (byClient[o.clientId] = {
            orders: {}, orderCount: 0, revenue: 0, lastOrderAt: 0, hasActiveOrder: false
        });
        bucket.orders[child.key] = p;
        if (p.isTest) return;                       // test orders never touch rollups
        bucket.orderCount += 1;
        bucket.revenue += p.amount;
        if (p.at > bucket.lastOrderAt) bucket.lastOrderAt = p.at;
        if (ACTIVE_ORDER_STATUSES.includes(p.serviceStatus)) bucket.hasActiveOrder = true;
    });
    return byClient;
}

async function handleGet(database, res) {
    const [clientsSnap, channelsSnap, ordersSnap, leadsSnap] = await Promise.all([
        database.ref(COLLECTIONS.clients).orderByChild('createdAt').limitToLast(2000).once('value'),
        database.ref('channels').once('value'),
        database.ref('orders').once('value'),
        database.ref('trialCampaignSubmissions').once('value')
    ]);

    const projections = buildProjections(ordersSnap);

    // Trial submissions are mirrored into the client book; keep the trial-side
    // facts (label, YouTube, genre) fresh on the client without the CRM having to
    // read a second node. One-way: the submission owns these fields.
    const trialByKey = {};
    if (leadsSnap.exists()) leadsSnap.forEach((child) => { trialByKey[child.key] = child.val() || {}; });

    const repair = {};

    const clients = snapshotToArray(clientsSnap).map((c) => {
        const p = projections[c.firebaseKey] || { orders: {}, orderCount: 0, revenue: 0, lastOrderAt: 0, hasActiveOrder: false };
        const t = c.trialKey ? trialByKey[c.trialKey] : null;
        const trialLive = t ? {
            youtubeLink: t.youtubeLink || c.youtubeLink || '',
            youtubeVideoId: t.youtubeVideoId || c.youtubeVideoId || '',
            youtubeThumbnailUrl: t.youtubeThumbnailUrl || c.youtubeThumbnailUrl || '',
            trial: {
                submissionId: t.submissionId || '',
                genre: t.genre || '', subgenre: t.subgenre || '',
                yearsMakingMusic: t.yearsMakingMusic || '',
                targetRegions: t.targetRegions || '', targetAgeGroup: t.targetAgeGroup || '',
                leadStatus: t.leadStatus === 'qualified' ? 'completed' : (t.leadStatus || 'new'),
                viewsStart: t.viewsStart == null ? null : Number(t.viewsStart),
                viewsEnd: t.viewsEnd == null ? null : Number(t.viewsEnd),
                adminNotes: t.adminNotes || ''
            }
        } : {};

        const merged = {
            ...c,
            ...trialLive,
            kind: deriveKind(c),
            orders: p.orders,
            orderCount: p.orderCount,
            revenue: p.revenue,
            lastOrderAt: p.lastOrderAt,
            hasActiveOrder: p.hasActiveOrder,
            // kept for older callers
            orderSummary: { count: p.orderCount, revenue: p.revenue, lastOrderAt: p.lastOrderAt }
        };
        // Persist the projection when it drifts, so the stored client node is
        // self-healing and always complete on its own.
        const stale = c.orderCount !== p.orderCount
            || Number(c.revenue || 0) !== p.revenue
            || Number(c.lastOrderAt || 0) !== p.lastOrderAt
            || !!c.hasActiveOrder !== p.hasActiveOrder
            // key-order-insensitive, so an unchanged projection never rewrites
            || ordersFingerprint(c.orders) !== ordersFingerprint(p.orders);
        if (stale) {
            const base = `${COLLECTIONS.clients}/${c.firebaseKey}`;
            repair[`${base}/orders`] = p.orders;
            repair[`${base}/orderCount`] = p.orderCount;
            repair[`${base}/revenue`] = p.revenue;
            repair[`${base}/lastOrderAt`] = p.lastOrderAt;
            repair[`${base}/hasActiveOrder`] = p.hasActiveOrder;
        }
        return merged;
    });

    if (Object.keys(repair).length) {
        // Best effort — never fail a read because the repair write did.
        database.ref().update(repair).catch((e) => console.error('Order projection repair failed:', e.message));
    }

    return res.status(200).json({
        success: true,
        clients,
        channels: snapshotToArray(channelsSnap),
        leads: snapshotToArray(leadsSnap)
    });
}

// Merge one client into another: the target keeps its identity, inherits every
// order (and therefore all revenue/history) from the source, backfills any field
// it was missing, and the source record is removed. This is how a duplicate
// (e.g. an auto-created "from order" customer) folds into the real client.
async function handleMerge(database, req, res, user) {
    const sourceKey = sanitizeString(req.body.sourceKey, 140);
    const targetKey = sanitizeString(req.body.targetKey, 140);
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
        return res.status(400).json({ error: 'Need two different clients to merge' });
    }

    const [srcSnap, tgtSnap, ordersSnap] = await Promise.all([
        database.ref(`${COLLECTIONS.clients}/${sourceKey}`).once('value'),
        database.ref(`${COLLECTIONS.clients}/${targetKey}`).once('value'),
        database.ref('orders').once('value')
    ]);
    if (!srcSnap.exists() || !tgtSnap.exists()) return res.status(404).json({ error: 'Client not found' });

    const src = srcSnap.val() || {};
    const tgt = tgtSnap.val() || {};
    const updates = {};
    const base = `${COLLECTIONS.clients}/${targetKey}`;
    const label = tgt.name || (tgt.handle ? '@' + tgt.handle : '') || tgt.email || 'Client';

    // Move every order over to the target.
    let moved = 0;
    if (ordersSnap.exists()) {
        ordersSnap.forEach((child) => {
            if ((child.val() || {}).clientId !== sourceKey) return;
            updates[`orders/${child.key}/clientId`] = targetKey;
            updates[`orders/${child.key}/clientName`] = label;
            updates[`orders/${child.key}/clientSlug`] = tgt.slug || '';
            moved += 1;
        });
    }

    // Backfill anything the target is missing from the source.
    for (const f of ['handle', 'name', 'slug', 'email', 'phone', 'niche', 'channel']) {
        if (!tgt[f] && src[f]) updates[`${base}/${f}`] = src[f];
    }
    if (!tgt.handleKey && src.handleKey) updates[`${base}/handleKey`] = src.handleKey;
    if (!tgt.emailKey && src.emailKey) updates[`${base}/emailKey`] = src.emailKey;
    if (!tgt.phoneKey && src.phoneKey) updates[`${base}/phoneKey`] = src.phoneKey;

    const notes = [tgt.note, src.note].map((n) => sanitizeString(n, 2000)).filter(Boolean);
    if (notes.length) updates[`${base}/note`] = notes.join('\n\n').slice(0, 2000);

    updates[`${base}/highlights`] = sanitizeHighlights([...(Array.isArray(tgt.highlights) ? tgt.highlights : []), ...(Array.isArray(src.highlights) ? src.highlights : [])]).slice(0, 40);
    updates[`${base}/history`] = sanitizeHistory([
        { at: Date.now(), text: `Merged in ${src.name || (src.handle ? '@' + src.handle : src.email || 'a duplicate')}` },
        ...(Array.isArray(tgt.history) ? tgt.history : []),
        ...(Array.isArray(src.history) ? src.history : [])
    ].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))).slice(0, 200);

    if (src.urgent && !tgt.urgent) updates[`${base}/urgent`] = true;
    if ((Number(src.lastContactedAt) || 0) > (Number(tgt.lastContactedAt) || 0)) updates[`${base}/lastContactedAt`] = Number(src.lastContactedAt) || null;
    if (!tgt.followUpAt && src.followUpAt) {
        updates[`${base}/followUpAt`] = Number(src.followUpAt) || null;
        updates[`${base}/followUpHasTime`] = !!src.followUpHasTime;
    }
    updates[`${base}/updatedAt`] = admin.database.ServerValue.TIMESTAMP;
    updates[`${base}/updatedBy`] = user.email || user.uid || '';

    // Drop the source record and any indexes that pointed at it.
    updates[`${COLLECTIONS.clients}/${sourceKey}`] = null;
    for (const [key, path] of [[src.handleKey, 'clientHandleIndex'], [src.emailKey, 'clientEmailIndex'], [src.phoneKey, 'clientPhoneIndex']]) {
        if (!key) continue;
        const idxSnap = await database.ref(`crm/${path}/${handleIndexKey(key)}`).once('value');
        if (idxSnap.val()?.clientKey === sourceKey) {
            // Re-point the index at the target rather than losing the lookup.
            updates[`crm/${path}/${handleIndexKey(key)}`] = path === 'clientHandleIndex'
                ? { clientKey: targetKey, handleKey: key }
                : { clientKey: targetKey };
        }
    }

    await database.ref().update(updates);
    return res.status(200).json({ success: true, movedOrders: moved, clientKey: targetKey });
}

async function handlePost(database, req, res, user) {
    if (req.body.action === 'merge') return handleMerge(database, req, res, user);
    const data = req.body.data || {};
    const handle = normalizeHandle(data.handle);
    const name = sanitizeString(data.name, 160);
    const email = sanitizeString(data.email, 200);
    // A client must be identifiable by at least one of: handle, name, email.
    if (!handle && !name && !email) {
        return res.status(400).json({ error: 'A handle, name, or email is required' });
    }

    const handleKey = handle.toLowerCase();
    const emailKey = normalizeEmail(email);
    const phone = sanitizeString(data.phone, 40);
    const phoneKey = normalizePhone(phone);

    const now = Date.now();
    const record = {
        handle,
        handleKey,
        name,
        slug: sanitizeString(data.slug, 160).toLowerCase(),
        email,
        emailKey,
        phone,
        phoneKey,
        niche: sanitizeString(data.niche, 120),
        channel: sanitizeString(data.channel, 120),
        status: clampStatus(data.status),
        kind: KINDS.includes(data.kind) ? data.kind : (clampStatus(data.status) === 'Lead' ? 'lead' : 'client'),
        activity: ACTIVITIES.includes(data.activity) ? data.activity : 'neutral',
        urgent: !!data.urgent,
        note: sanitizeString(data.note, 2000),
        needsReply: !!data.needsReply,
        followUpAt: data.followUpAt == null ? null : (Number(data.followUpAt) || null),
        followUpHasTime: !!data.followUpHasTime,
        lastContactedAt: now,
        highlights: sanitizeHighlights(data.highlights),
        history: [{ at: now, text: 'Added to clients' }],
        source: SOURCES.includes(data.source) ? data.source : 'manual',
        archived: false,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        createdBy: user.email || user.uid || '',
        updatedBy: user.email || user.uid || ''
    };

    const newRef = database.ref(COLLECTIONS.clients).push();

    // Only handles are uniqueness-guarded (transactional claim, mirrors the old
    // behaviour). A read-then-write check can create duplicates when two adds race.
    if (handleKey) {
        const indexRef = database.ref(`crm/clientHandleIndex/${handleIndexKey(handleKey)}`);
        const claim = await indexRef.transaction((current) => {
            if (current && current.clientKey) return;
            return { clientKey: newRef.key, handleKey };
        });
        if (!claim.committed) {
            return res.status(409).json({ error: 'A client with that handle already exists', clientKey: claim.snapshot.val()?.clientKey });
        }
        try {
            await newRef.set(record);
        } catch (error) {
            await indexRef.transaction((current) => (current?.clientKey === newRef.key ? null : current));
            throw error;
        }
    } else {
        await newRef.set(record);
    }

    // Best-effort contact indexes (used for order auto-linking; handle stays the
    // hard uniqueness key). Only claim if not already pointing elsewhere.
    if (emailKey) {
        await database.ref(`crm/clientEmailIndex/${handleIndexKey(emailKey)}`)
            .transaction((cur) => (cur && cur.clientKey ? undefined : { clientKey: newRef.key }));
    }
    if (phoneKey) {
        await database.ref(`crm/clientPhoneIndex/${handleIndexKey(phoneKey)}`)
            .transaction((cur) => (cur && cur.clientKey ? undefined : { clientKey: newRef.key }));
    }

    return res.status(200).json({ success: true, firebaseKey: newRef.key });
}

async function handlePatch(database, req, res, user) {
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    if (!firebaseKey) {
        return res.status(400).json({ error: 'Invalid update target' });
    }

    const clientRef = database.ref(`${COLLECTIONS.clients}/${firebaseKey}`);
    const existingSnapshot = await clientRef.once('value');
    if (!existingSnapshot.exists()) {
        return res.status(404).json({ error: 'Client not found' });
    }

    const existing = existingSnapshot.val() || {};
    const updates = normalizeUpdates(req.body.updates || {}, user);
    const oldHandleKey = existing.handleKey || normalizeHandle(existing.handle).toLowerCase();
    const handleChanged = updates.handleKey && updates.handleKey !== oldHandleKey;
    let newIndexRef = null;

    if (handleChanged) {
        newIndexRef = database.ref(`crm/clientHandleIndex/${handleIndexKey(updates.handleKey)}`);
        const claim = await newIndexRef.transaction((current) => {
            if (current && current.clientKey !== firebaseKey) return;
            return { clientKey: firebaseKey, handleKey: updates.handleKey };
        });
        if (!claim.committed) {
            return res.status(409).json({ error: 'A client with that handle already exists', clientKey: claim.snapshot.val()?.clientKey });
        }
    }

    try {
        await clientRef.update(updates);
        if (handleChanged && oldHandleKey) {
            await database.ref(`crm/clientHandleIndex/${handleIndexKey(oldHandleKey)}`).remove();
        }
    } catch (error) {
        if (newIndexRef) {
            await newIndexRef.transaction((current) => (current?.clientKey === firebaseKey ? null : current));
        }
        throw error;
    }

    return res.status(200).json({ success: true });
}

async function handleDelete(database, req, res) {
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    if (!firebaseKey) {
        return res.status(400).json({ error: 'Invalid delete target' });
    }

    const snapshot = await database.ref(`${COLLECTIONS.clients}/${firebaseKey}`).once('value');
    const client = snapshot.val() || {};
    if (client.handleKey) {
        await database.ref(`crm/clientHandleIndex/${handleIndexKey(client.handleKey)}`).remove();
    }

    await database.ref(`${COLLECTIONS.clients}/${firebaseKey}`).remove();
    return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const database = getDatabase();
        const user = await requireFirebaseUser(req);

        if (req.method === 'GET') return await handleGet(database, res);
        if (req.method === 'POST') return await handlePost(database, req, res, user);
        if (req.method === 'PATCH') return await handlePatch(database, req, res, user);
        if (req.method === 'DELETE') return await handleDelete(database, req, res);

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('CRM admin API error:', error);
        return res.status(statusCode).json({
            error: statusCode === 401 ? 'Unauthorized' : 'CRM admin API failed',
            message: error.message
        });
    }
}
