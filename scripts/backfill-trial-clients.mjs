// Mirror existing trial-campaign submissions into the shared client book as Leads,
// so they're editable in the CRM alongside their YouTube info.
// DRY-RUN by default; pass --commit to write.
//
//   node scripts/backfill-trial-clients.mjs
//   node scripts/backfill-trial-clients.mjs --commit
//
// Idempotent: crm/clientTrialIndex/{submissionId} guards against duplicates, and
// any client already carrying the trialKey is skipped.

import { admin, getDatabase } from '../api/_firebase-admin.js';

const COMMIT = process.argv.includes('--commit');
const db = getDatabase();

function normHandle(v) {
    return String(v || '').trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/.*$/, '').replace(/\?.*$/, '')
        .toLowerCase().trim();
}
// Trial label -> CRM relationship status.
function statusFor(leadStatus) {
    const s = leadStatus === 'qualified' ? 'completed' : (leadStatus || 'new');
    if (s === 'converted') return 'Client';
    if (s === 'contacted') return 'Warm';
    if (s === 'archived') return 'Stale';
    return 'Lead';                      // new | completed
}

const read = async (p) => (await db.ref(p).once('value')).val() || {};
const [leads, clients, index] = await Promise.all([
    read('trialCampaignSubmissions'), read('crm/clients'), read('crm/clientTrialIndex')
]);

const linkedKeys = new Set(Object.values(clients).map((c) => c.trialKey).filter(Boolean));
const handleToClient = new Map();
for (const [k, c] of Object.entries(clients)) {
    const h = normHandle(c.handle);
    if (h) handleToClient.set(h, k);
}

const toCreate = [];
const toAttach = [];   // existing client (matched by handle) gains the trial info
const skipped = [];

for (const [key, l] of Object.entries(leads)) {
    const sid = l.submissionId || key;
    if (linkedKeys.has(key) || index[sid]?.clientKey) { skipped.push(sid); continue; }

    const handle = normHandle(l.instagramLink);
    const existing = handle ? handleToClient.get(handle) : null;
    const payload = {
        trialKey: key,
        trialSubmissionId: sid,
        youtubeLink: l.youtubeLink || '',
        youtubeVideoId: l.youtubeVideoId || '',
        youtubeThumbnailUrl: l.youtubeThumbnailUrl || '',
        trial: {
            submissionId: sid,
            genre: l.genre || '', subgenre: l.subgenre || '',
            yearsMakingMusic: l.yearsMakingMusic || '',
            targetRegions: l.targetRegions || '', targetAgeGroup: l.targetAgeGroup || '',
            leadStatus: l.leadStatus === 'qualified' ? 'completed' : (l.leadStatus || 'new'),
            viewsStart: l.viewsStart == null ? null : Number(l.viewsStart),
            viewsEnd: l.viewsEnd == null ? null : Number(l.viewsEnd),
            adminNotes: l.adminNotes || ''
        }
    };

    if (existing) { toAttach.push({ clientKey: existing, sid, payload, name: l.fullName || '' }); continue; }

    const at = Number(l.createdAt) || (l.submittedAtIso ? Date.parse(l.submittedAtIso) : 0) || Date.now();
    toCreate.push({
        sid,
        record: {
            handle, handleKey: handle,
            name: l.fullName || '',
            slug: '',
            email: '', emailKey: '', phone: '', phoneKey: '',
            niche: l.genre || '',
            channel: '',
            status: statusFor(l.leadStatus),
            activity: 'neutral',
            urgent: false,
            needsReply: false,
            note: l.adminNotes || '',
            highlights: [],
            history: [{ at, text: 'Imported from trial campaign' }],
            followUpAt: null, followUpHasTime: false,
            lastContactedAt: null,
            source: 'trial',
            archived: false,
            createdAt: at,
            updatedAt: Date.now(),
            createdBy: 'migration', updatedBy: 'migration',
            ...payload
        }
    });
}

console.log(`\n===== TRIAL → CLIENT BACKFILL (${COMMIT ? 'COMMIT' : 'DRY RUN'}) =====`);
console.log('trial submissions:', Object.keys(leads).length);
console.log('already mirrored (skipped):', skipped.length);
console.log('attach to existing client matched by @handle:', toAttach.length, toAttach.map((a) => a.name || a.sid));
console.log('create new Lead clients:', toCreate.length);
const byStatus = toCreate.reduce((m, c) => { m[c.record.status] = (m[c.record.status] || 0) + 1; return m; }, {});
console.log('  new clients by status:', byStatus);
console.log('  with a YouTube link:', toCreate.filter((c) => c.record.youtubeLink).length, '| with an @handle:', toCreate.filter((c) => c.record.handle).length);
if (toCreate[0]) console.log('\nsample:', JSON.stringify(toCreate[0].record));

if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.');
    process.exit(0);
}

const updates = {};
for (const { sid, record } of toCreate) {
    const key = db.ref('crm/clients').push().key;
    updates[`crm/clients/${key}`] = record;
    updates[`crm/clientTrialIndex/${sid}`] = { clientKey: key };
    if (record.handleKey) {
        updates[`crm/clientHandleIndex/${Buffer.from(record.handleKey, 'utf8').toString('base64url')}`] = { clientKey: key, handleKey: record.handleKey };
    }
}
for (const { clientKey, sid, payload } of toAttach) {
    for (const [k, v] of Object.entries(payload)) updates[`crm/clients/${clientKey}/${k}`] = v;
    updates[`crm/clients/${clientKey}/updatedAt`] = Date.now();
    updates[`crm/clientTrialIndex/${sid}`] = { clientKey };
}

await db.ref().update(updates);
console.log(`\nWrote ${Object.keys(updates).length} paths. Trial submissions left intact.`);
process.exit(0);
