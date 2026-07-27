import { admin, getDatabase } from './_firebase-admin.js';

// Trial-lead admin writes. Reads still go through get-trial-campaigns (public GET);
// this endpoint handles authed PATCH/DELETE because trialCampaignSubmissions isn't
// exposed to the client SDK by RTDB rules (mirrors the crm-admin pattern).

const COLLECTION = 'trialCampaignSubmissions';
const TRIAL_STATUSES = ['new', 'completed', 'contacted', 'converted', 'archived'];
const ACTIVITIES = ['active', 'neutral', 'dormant'];

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

function sanitizeString(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function numberOrNull(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(updates, k);
    if (has('leadStatus')) out.leadStatus = TRIAL_STATUSES.includes(updates.leadStatus) ? updates.leadStatus : 'new';
    if (has('activity')) out.activity = ACTIVITIES.includes(updates.activity) ? updates.activity : 'neutral';
    if (has('viewsStart')) out.viewsStart = numberOrNull(updates.viewsStart);
    if (has('viewsEnd')) out.viewsEnd = numberOrNull(updates.viewsEnd);
    if (has('commentsGiven')) out.commentsGiven = !!updates.commentsGiven;
    if (has('likesGiven')) out.likesGiven = !!updates.likesGiven;
    if (has('instagramLink')) out.instagramLink = updates.instagramLink == null ? null : sanitizeString(updates.instagramLink, 300);
    if (has('adminNotes')) out.adminNotes = sanitizeString(updates.adminNotes, 2000);
    out.updatedAt = admin.database.ServerValue.TIMESTAMP;
    out.updatedBy = user.email || user.uid || '';
    return out;
}

async function handlePatch(database, req, res, user) {
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    if (!firebaseKey) return res.status(400).json({ error: 'Invalid update target' });
    const leadRef = database.ref(`${COLLECTION}/${firebaseKey}`);
    if (!(await leadRef.once('value')).exists()) return res.status(404).json({ error: 'Lead not found' });
    await leadRef.update(normalizeUpdates(req.body.updates || {}, user));
    return res.status(200).json({ success: true });
}

async function handleDelete(database, req, res) {
    const firebaseKey = sanitizeString(req.body.firebaseKey, 140);
    if (!firebaseKey) return res.status(400).json({ error: 'Invalid delete target' });
    await database.ref(`${COLLECTION}/${firebaseKey}`).remove();
    return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    try {
        const database = getDatabase();
        const user = await requireFirebaseUser(req);
        if (req.method === 'PATCH') return await handlePatch(database, req, res, user);
        if (req.method === 'DELETE') return await handleDelete(database, req, res);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('Trial admin API error:', error);
        return res.status(statusCode).json({
            error: statusCode === 401 ? 'Unauthorized' : 'Trial admin API failed',
            message: error.message
        });
    }
}
