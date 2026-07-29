import { admin, getDatabase } from './_firebase-admin.js';

function extractYouTubeVideoId(urlString) {
    if (!urlString) return '';

    try {
        const url = new URL(urlString.trim());
        const hostname = url.hostname.replace(/^www\./, '');

        if (hostname === 'youtu.be') {
            return url.pathname.split('/').filter(Boolean)[0] || '';
        }

        if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com') {
            if (url.pathname === '/watch') {
                return url.searchParams.get('v') || '';
            }

            if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
                return url.pathname.split('/').filter(Boolean)[1] || '';
            }
        }
    } catch (error) {
        return '';
    }

    return '';
}

function sanitizeString(value, maxLength = 200) {
    return String(value || '').trim().slice(0, maxLength);
}

function parseRegions(value) {
    return String(value || '')
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function createSubmissionId() {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TC-${datePart}-${randomPart}`;
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
        const fullName = sanitizeString(req.body.fullName, 120);
        const genre = sanitizeString(req.body.genre, 60);
        const subgenre = sanitizeString(req.body.subgenre, 80);
        const yearsMakingMusic = sanitizeString(req.body.yearsMakingMusic, 80);
        const youtubeLink = sanitizeString(req.body.youtubeLink, 500);
        const targetRegions = sanitizeString(req.body.targetRegions, 500);
        const targetAgeGroup = sanitizeString(req.body.targetAgeGroup, 80);

        if (!fullName || !genre || !yearsMakingMusic || !youtubeLink || !targetAgeGroup) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Please complete all required fields before submitting.'
            });
        }

        const youtubeVideoId = extractYouTubeVideoId(youtubeLink);
        if (!youtubeVideoId) {
            return res.status(400).json({
                error: 'Invalid YouTube link',
                message: 'Please provide a valid YouTube video URL.'
            });
        }

        const targetRegionsList = parseRegions(targetRegions);
        const submissionId = createSubmissionId();
        const youtubeThumbnailUrl = `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;

        const submissionData = {
            submissionId,
            fullName,
            genre,
            subgenre,
            yearsMakingMusic,
            youtubeLink,
            youtubeVideoId,
            youtubeThumbnailUrl,
            targetRegions,
            targetRegionsList,
            targetAgeGroup,
            source: 'trial-campaign',
            leadStatus: 'new',
            adminNotes: '',
            submittedAtIso: new Date().toISOString(),
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress || '',
            userAgent: req.headers['user-agent'] || ''
        };

        const trialCampaignRef = database.ref('trialCampaignSubmissions');
        const newSubmissionRef = await trialCampaignRef.push(submissionData);

        // Mirror the submission into the shared client book as a Lead, so it shows
        // up (and is editable) in the CRM straight away with its YouTube info.
        // Keyed by submissionId so a retry can never create a duplicate.
        try {
            const claim = await database.ref(`crm/clientTrialIndex/${submissionId}`)
                .transaction((cur) => (cur && cur.clientKey ? undefined : { pending: true }));
            if (claim.committed) {
                const clientRef = database.ref('crm/clients').push();
                await clientRef.set({
                    handle: '', handleKey: '',
                    name: fullName,
                    slug: '',
                    email: '', emailKey: '', phone: '', phoneKey: '',
                    niche: genre || '',
                    channel: '',
                    status: 'Lead',
                    kind: 'lead',
                    activity: 'neutral',
                    urgent: false,
                    needsReply: false,
                    note: '',
                    highlights: [],
                    history: [{ at: Date.now(), text: 'Trial campaign submission' }],
                    followUpAt: null, followUpHasTime: false,
                    lastContactedAt: null,
                    source: 'trial',
                    trialKey: newSubmissionRef.key,
                    trialSubmissionId: submissionId,
                    youtubeLink,
                    youtubeVideoId,
                    youtubeThumbnailUrl,
                    trial: {
                        submissionId, genre, subgenre, yearsMakingMusic,
                        targetRegions, targetAgeGroup, leadStatus: 'new'
                    },
                    archived: false,
                    createdAt: admin.database.ServerValue.TIMESTAMP,
                    updatedAt: admin.database.ServerValue.TIMESTAMP,
                    createdBy: 'trial-campaign', updatedBy: 'trial-campaign'
                });
                await database.ref(`crm/clientTrialIndex/${submissionId}`).set({ clientKey: clientRef.key });
            }
        } catch (crmErr) {
            // Never fail the submission because the CRM mirror hiccuped.
            console.error('Trial → CRM client mirror failed (submission still saved):', crmErr.message);
        }

        console.log('Trial campaign stored successfully:', {
            firebaseKey: newSubmissionRef.key,
            submissionId,
            genre,
            youtubeVideoId,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            firebaseKey: newSubmissionRef.key,
            submissionId,
            message: 'Trial campaign submitted successfully'
        });
    } catch (error) {
        console.error('Error storing trial campaign data:', error);

        return res.status(500).json({
            error: 'Failed to store trial campaign data',
            message: error.message
        });
    }
}
