import { admin, getDatabase } from './_firebase-admin.js';

function sanitizeString(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function isValidUrl(value, allowedHosts) {
    if (!value) return false;

    try {
        const url = new URL(value);
        const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
        return ['http:', 'https:'].includes(url.protocol) && allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch (error) {
        return false;
    }
}

function createReferenceId(prefix) {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${datePart}-${randomPart}`;
}

export default async function handler(req, res) {
    const database = getDatabase();

    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const type = sanitizeString(req.body.type, 40);
        const nowIso = new Date().toISOString();

        if (type === 'page') {
            const instagramUrl = sanitizeString(req.body.instagramUrl, 500);

            if (!isValidUrl(instagramUrl, ['instagram.com'])) {
                return res.status(400).json({
                    error: 'Invalid Instagram URL',
                    message: 'Please provide a valid Instagram page URL.'
                });
            }

            const pageData = {
                pageId: createReferenceId('PG'),
                instagramUrl,
                source: 'lead-outreach-form',
                pageStatus: 'active',
                isExhausted: false,
                notes: '',
                createdAt: admin.database.ServerValue.TIMESTAMP,
                updatedAt: admin.database.ServerValue.TIMESTAMP,
                submittedAtIso: nowIso,
                ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || '',
                userAgent: req.headers['user-agent'] || ''
            };

            const newPageRef = await database.ref('leadOutreach/pages').push(pageData);

            return res.status(200).json({
                success: true,
                firebaseKey: newPageRef.key,
                pageId: pageData.pageId,
                message: 'Page submitted successfully'
            });
        }

        const instagramLink = sanitizeString(req.body.instagramLink, 500);
        const youtubeLink = sanitizeString(req.body.youtubeLink, 500);

        if (!isValidUrl(instagramLink, ['instagram.com'])) {
            return res.status(400).json({
                error: 'Invalid Instagram link',
                message: 'Please provide a valid Instagram link.'
            });
        }

        if (youtubeLink && !isValidUrl(youtubeLink, ['youtube.com', 'youtu.be'])) {
            return res.status(400).json({
                error: 'Invalid YouTube link',
                message: 'Please provide a valid YouTube link or leave it blank.'
            });
        }

        const leadData = {
            leadId: createReferenceId('LD'),
            instagramLink,
            youtubeLink,
            source: 'lead-outreach-form',
            leadStatus: 'new',
            discardReason: '',
            adminNotes: '',
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            submittedAtIso: nowIso,
            ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || '',
            userAgent: req.headers['user-agent'] || ''
        };

        const newLeadRef = await database.ref('leadOutreach/leads').push(leadData);

        return res.status(200).json({
            success: true,
            firebaseKey: newLeadRef.key,
            leadId: leadData.leadId,
            message: 'Lead submitted successfully'
        });
    } catch (error) {
        console.error('Error storing lead outreach data:', error);

        return res.status(500).json({
            error: 'Failed to store lead outreach data',
            message: error.message
        });
    }
}
