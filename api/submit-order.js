import { admin, getDatabase } from './_firebase-admin.js';

function idxKey(s) { return Buffer.from(String(s).toLowerCase(), 'utf8').toString('base64url'); }
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function normPhone(v) { return String(v || '').replace(/[^\d+]/g, '').trim(); }

// Find an existing unified client by email/phone, or create one, so every paid
// order lands on a client record automatically. Returns { clientKey, name } or null.
async function findOrCreateClient(database, { email, phone, fullName }) {
    const emailKey = normEmail(email);
    const phoneKey = normPhone(phone);
    if (!emailKey && !phoneKey) return null;

    // Look up contact indexes first.
    for (const [key, path] of [[emailKey, 'clientEmailIndex'], [phoneKey, 'clientPhoneIndex']]) {
        if (!key) continue;
        const snap = await database.ref(`crm/${path}/${idxKey(key)}`).once('value');
        const clientKey = snap.val()?.clientKey;
        if (clientKey) {
            const c = await database.ref(`crm/clients/${clientKey}`).once('value');
            if (c.exists()) return { clientKey, name: c.val().name || fullName || '' };
        }
    }

    // Create a new "from order" client.
    const now = Date.now();
    const ref = database.ref('crm/clients').push();
    await ref.set({
        handle: '', handleKey: '',
        name: String(fullName || email || 'Customer').slice(0, 160),
        slug: '',
        email: String(email || ''), emailKey,
        phone: String(phone || ''), phoneKey,
        niche: '', channel: '',
        status: 'Client', activity: 'active',
        needsReply: false, urgent: false,
        note: '',
        highlights: [], history: [{ at: now, text: 'Created from order' }],
        followUpAt: null, followUpHasTime: false,
        lastContactedAt: now,
        source: 'order',
        archived: false,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        createdBy: 'checkout', updatedBy: 'checkout'
    });
    if (emailKey) await database.ref(`crm/clientEmailIndex/${idxKey(emailKey)}`).transaction((cur) => (cur && cur.clientKey ? undefined : { clientKey: ref.key }));
    if (phoneKey) await database.ref(`crm/clientPhoneIndex/${idxKey(phoneKey)}`).transaction((cur) => (cur && cur.clientKey ? undefined : { clientKey: ref.key }));
    return { clientKey: ref.key, name: fullName || email || 'Customer' };
}

export default async function handler(req, res) {
    // Initialize Firebase if needed
    const database = getDatabase();
    
    // Set CORS headers
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
        const {
            orderID,
            amount,
            currency,
            youtubeLink,
            fullName,
            email,
            phone,
            timestamp,
            paypalData,
            status
        } = req.body;

        // Validate required fields
        if (!orderID || !amount || !youtubeLink) {
            return res.status(400).json({ 
                error: 'Missing required fields: orderID, amount, or youtubeLink' 
            });
        }

        if (!email && !phone) {
            return res.status(400).json({ 
                error: 'Either email or phone number is required' 
            });
        }

        // Prepare the order data
        const orderData = {
            app: 'youtube-promotion',
            orderID,
            amount: parseFloat(amount),
            currency: currency || 'USD',
            youtubeLink,
            fullName: fullName || '',
            email: email || '',
            phone: phone || '',
            timestamp: timestamp || new Date().toISOString(),
            status: status || 'completed',
            createdAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            
            // PayPal transaction details
            paypalTransactionId: paypalData?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '',
            paypalStatus: paypalData?.status || '',
            paypalCreateTime: paypalData?.create_time || '',
            paypalUpdateTime: paypalData?.update_time || '',
            
            // Additional metadata
            ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'] || '',
            
            // Service status
            serviceStatus: 'pending', // pending, in_progress, completed, cancelled
            notes: '',
            adminNotes: ''
        };

        // Auto-link this order to a unified client (find-or-create by email/phone),
        // so the client book and their order history stay current with no manual step.
        try {
            const client = await findOrCreateClient(database, { email, phone, fullName });
            if (client) {
                orderData.clientId = client.clientKey;
                orderData.clientName = client.name || '';
                orderData.clientSlug = '';
            }
        } catch (linkErr) {
            // Never fail an order write because linking hiccuped — the migration/admin
            // can link it later. Log and continue.
            console.error('Order client-link failed (order still saved):', linkErr.message);
        }

        // Store in Firebase Realtime Database
        const ordersRef = database.ref('orders');
        const newOrderRef = await ordersRef.push(orderData);
        
        console.log('Order stored successfully:', {
            firebaseKey: newOrderRef.key,
            orderID,
            amount,
            youtubeLink: youtubeLink.substring(0, 50) + '...',
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({ 
            success: true,
            firebaseKey: newOrderRef.key,
            orderID: orderID,
            message: 'Order data stored successfully'
        });

    } catch (error) {
        console.error('Error storing order data:', error);
        
        return res.status(500).json({ 
            error: 'Failed to store order data',
            message: error.message 
        });
    }
}
