import { getDatabase } from './_firebase-admin.js';

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

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Fetching trial campaign submissions from Firebase...');

        const trialCampaignRef = database.ref('trialCampaignSubmissions');
        const snapshot = await trialCampaignRef.orderByChild('createdAt').limitToLast(200).once('value');

        const trialCampaigns = [];
        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                trialCampaigns.push({
                    firebaseKey: childSnapshot.key,
                    ...childSnapshot.val()
                });
            });
        }

        trialCampaigns.reverse();

        console.log(`Found ${trialCampaigns.length} trial campaign submissions`);

        return res.status(200).json({
            success: true,
            trialCampaigns,
            count: trialCampaigns.length
        });
    } catch (error) {
        console.error('Error fetching trial campaigns:', error);

        return res.status(500).json({
            error: 'Failed to fetch trial campaigns',
            message: error.message
        });
    }
}
