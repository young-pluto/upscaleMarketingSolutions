import { getDatabase } from './_firebase-admin.js';

function isYoutubePromotionOrder(order) {
    return order?.app === 'youtube-promotion'
        || Boolean(order?.youtubeLink)
        || Boolean(order?.orderID)
        || Boolean(order?.paypalTransactionId);
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

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Fetching orders from Firebase...');
        
        const ordersRef = database.ref('orders');
        const snapshot = await ordersRef.orderByChild('createdAt').limitToLast(100).once('value');
        
        const orders = [];
        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const order = {
                    firebaseKey: childSnapshot.key,
                    ...childSnapshot.val()
                };

                if (isYoutubePromotionOrder(order)) {
                    orders.push(order);
                }
            });
        }

        // Sort by most recent first
        orders.reverse();

        console.log(`Found ${orders.length} orders`);
        
        return res.status(200).json({ 
            success: true,
            orders: orders,
            count: orders.length
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        
        return res.status(500).json({ 
            error: 'Failed to fetch orders',
            message: error.message 
        });
    }
} 
