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

async function handleGet(database, res) {
    const snapshot = await database
        .ref(COLLECTIONS.clients)
        .orderByChild('createdAt')
        .limitToLast(2000)
        .once('value');

    return res.status(200).json({
        success: true,
        clients: snapshotToArray(snapshot)
    });
}

async function handlePost(database, req, res, user) {
    const data = req.body.data || {};
    const handle = normalizeHandle(data.handle);
    if (!handle) {
        return res.status(400).json({ error: 'Instagram handle is required' });
    }

    const handleKey = handle.toLowerCase();
    const indexKey = handleIndexKey(handleKey);

    const now = Date.now();
    const record = {
        handle,
        handleKey,
        niche: sanitizeString(data.niche, 120),
        status: clampStatus(data.status),
        note: sanitizeString(data.note, 2000),
        needsReply: !!data.needsReply,
        followUpAt: data.followUpAt == null ? null : (Number(data.followUpAt) || null),
        lastContactedAt: now,
        highlights: sanitizeHighlights(data.highlights),
        history: [{ at: now, text: 'Added to clients' }],
        archived: false,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        createdBy: user.email || user.uid || '',
        updatedBy: user.email || user.uid || ''
    };

    const newRef = database.ref(COLLECTIONS.clients).push();
    const indexRef = database.ref(`crm/clientHandleIndex/${indexKey}`);

    // A read-then-write check can create duplicates when two add requests arrive
    // together. Claim the handle index transactionally before writing the client.
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
        // Do not leave a claimed handle behind if the client write fails.
        await indexRef.transaction((current) => (current?.clientKey === newRef.key ? null : current));
        throw error;
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
