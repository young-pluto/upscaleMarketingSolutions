import { admin, getDatabase } from './_firebase-admin.js';

const COLLECTIONS = {
    leads: 'leadOutreach/leads',
    pages: 'leadOutreach/pages',
    clipboardMessages: 'leadOutreach/clipboardMessages',
    channels: 'leadOutreach/channels'
};

const SERVER_TIMESTAMP = '__SERVER_TIMESTAMP__';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

function sanitizeString(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function createReferenceId(prefix) {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${datePart}-${randomPart}`;
}

function extractInstagramUsername(value) {
    try {
        const url = new URL(String(value || '').trim());
        return (url.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '').toLowerCase();
    } catch (error) {
        return '';
    }
}

function createInstagramIndexKey(username) {
    return Buffer.from(username.toLowerCase(), 'utf8').toString('base64url');
}

function getCollectionPath(collection) {
    return COLLECTIONS[collection] || '';
}

function snapshotToArray(snapshot) {
    const items = [];

    if (!snapshot.exists()) {
        return items;
    }

    snapshot.forEach((childSnapshot) => {
        items.push({
            firebaseKey: childSnapshot.key,
            ...childSnapshot.val()
        });
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

function normalizeUpdates(collection, updates, user) {
    const allowedFields = {
        leads: ['leadStatus', 'discardReason', 'adminNotes', 'contactedAt', 'convertedAt', 'discardedAt', 'outreachChannelId', 'outreachChannelName'],
        pages: ['instagramUrl', 'isExhausted', 'pageStatus', 'exhaustedAt', 'notes'],
        clipboardMessages: ['title', 'body'],
        channels: ['name', 'isActive']
    };

    const normalized = {};
    for (const field of allowedFields[collection] || []) {
        if (!Object.prototype.hasOwnProperty.call(updates, field)) continue;

        if (updates[field] === SERVER_TIMESTAMP) {
            normalized[field] = admin.database.ServerValue.TIMESTAMP;
        } else if (typeof updates[field] === 'string') {
            normalized[field] = sanitizeString(updates[field], field === 'body' || field === 'adminNotes' || field === 'notes' ? 5000 : 500);
        } else {
            normalized[field] = updates[field];
        }
    }

    normalized.updatedAt = admin.database.ServerValue.TIMESTAMP;
    normalized.updatedBy = user.email || user.uid || '';

    if (collection === 'leads' && updates.leadStatus === 'contacted') {
        normalized.contactedBy = user.email || user.uid || '';
    }

    if (collection === 'leads' && updates.leadStatus === 'converted') {
        normalized.convertedBy = user.email || user.uid || '';
    }

    if (collection === 'leads' && updates.leadStatus === 'discarded') {
        normalized.discardedBy = user.email || user.uid || '';
    }

    return normalized;
}

async function ensureLeadIndexes(database, leads) {
    const updates = {};

    for (const lead of leads) {
        const username = lead.instagramUsernameKey || extractInstagramUsername(lead.instagramLink);
        if (!username) continue;

        const indexKey = createInstagramIndexKey(username);
        updates[`leadOutreach/leads/${lead.firebaseKey}/instagramUsername`] = lead.instagramUsername || username;
        updates[`leadOutreach/leads/${lead.firebaseKey}/instagramUsernameKey`] = username;
        updates[`leadOutreach/leadInstagramIndex/${indexKey}/leadKey`] = lead.firebaseKey;
        updates[`leadOutreach/leadInstagramIndex/${indexKey}/username`] = username;
        updates[`leadOutreach/leadInstagramIndex/${indexKey}/instagramUsernameKey`] = username;
    }

    if (Object.keys(updates).length > 0) {
        await database.ref().update(updates);
    }
}

async function handleGet(database, res) {
    const [leadsSnapshot, pagesSnapshot, messagesSnapshot, channelsSnapshot] = await Promise.all([
        database.ref(COLLECTIONS.leads).orderByChild('createdAt').limitToLast(500).once('value'),
        database.ref(COLLECTIONS.pages).orderByChild('createdAt').limitToLast(500).once('value'),
        database.ref(COLLECTIONS.clipboardMessages).orderByChild('createdAt').limitToLast(200).once('value'),
        database.ref(COLLECTIONS.channels).orderByChild('createdAt').limitToLast(100).once('value')
    ]);
    const leads = snapshotToArray(leadsSnapshot);
    await ensureLeadIndexes(database, leads);

    return res.status(200).json({
        success: true,
        leads,
        pages: snapshotToArray(pagesSnapshot),
        clipboardMessages: snapshotToArray(messagesSnapshot),
        channels: snapshotToArray(channelsSnapshot)
    });
}

async function handlePost(database, req, res, user) {
    const collection = sanitizeString(req.body.collection, 80);
    const collectionPath = getCollectionPath(collection);

    if (!collectionPath || !['pages', 'clipboardMessages', 'channels'].includes(collection)) {
        return res.status(400).json({ error: 'Invalid collection' });
    }

    let data;

    if (collection === 'pages') {
        data = {
            pageId: createReferenceId('PG'),
            instagramUrl: sanitizeString(req.body.data?.instagramUrl, 500),
            source: 'lead-outreach-board',
            pageStatus: 'active',
            isExhausted: false,
            notes: '',
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            createdBy: user.email || user.uid || ''
        };

        if (!data.instagramUrl) {
            return res.status(400).json({ error: 'Instagram URL is required' });
        }
    }

    if (collection === 'clipboardMessages') {
        data = {
            title: sanitizeString(req.body.data?.title, 80),
            body: sanitizeString(req.body.data?.body, 5000),
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            createdBy: user.email || user.uid || ''
        };

        if (!data.title || !data.body) {
            return res.status(400).json({ error: 'Message title and body are required' });
        }
    }

    if (collection === 'channels') {
        data = {
            channelId: createReferenceId('CH'),
            name: sanitizeString(req.body.data?.name, 80),
            isActive: true,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            createdBy: user.email || user.uid || ''
        };

        if (!data.name) {
            return res.status(400).json({ error: 'Channel name is required' });
        }
    }

    const newRef = await database.ref(collectionPath).push(data);
    return res.status(200).json({
        success: true,
        firebaseKey: newRef.key
    });
}

async function handlePatch(database, req, res, user) {
    const collection = sanitizeString(req.body.collection, 80);
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    const collectionPath = getCollectionPath(collection);

    if (!collectionPath || !firebaseKey) {
        return res.status(400).json({ error: 'Invalid update target' });
    }

    const updates = normalizeUpdates(collection, req.body.updates || {}, user);
    await database.ref(`${collectionPath}/${firebaseKey}`).update(updates);

    return res.status(200).json({ success: true });
}

async function handleDelete(database, req, res) {
    const collection = sanitizeString(req.body.collection, 80);
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    const collectionPath = getCollectionPath(collection);

    if (!collectionPath || !firebaseKey) {
        return res.status(400).json({ error: 'Invalid delete target' });
    }

    if (collection === 'leads') {
        const snapshot = await database.ref(`${collectionPath}/${firebaseKey}`).once('value');
        const lead = snapshot.val() || {};
        const username = lead.instagramUsernameKey || extractInstagramUsername(lead.instagramLink);
        if (username) {
            await database.ref(`leadOutreach/leadInstagramIndex/${createInstagramIndexKey(username)}`).remove();
        }
    }

    await database.ref(`${collectionPath}/${firebaseKey}`).remove();
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

        if (req.method === 'GET') {
            return await handleGet(database, res);
        }

        if (req.method === 'POST') {
            return await handlePost(database, req, res, user);
        }

        if (req.method === 'PATCH') {
            return await handlePatch(database, req, res, user);
        }

        if (req.method === 'DELETE') {
            return await handleDelete(database, req, res);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('Lead outreach admin API error:', error);

        return res.status(statusCode).json({
            error: statusCode === 401 ? 'Unauthorized' : 'Lead outreach admin API failed',
            message: error.message
        });
    }
}
