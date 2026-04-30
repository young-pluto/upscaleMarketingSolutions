import { getDatabase } from './_firebase-admin.js';

export default async function handler(req, res) {
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

    const { orderId } = req.query;

    if (!orderId) {
        return res.status(400).json({ 
            error: 'Order ID is required',
            message: 'Please provide an order ID' 
        });
    }

    try {
        console.log(`Fetching order details for: ${orderId}`);
        
        const ordersRef = database.ref('orders');
        const snapshot = await ordersRef.orderByChild('orderID').equalTo(orderId).once('value');
        
        if (!snapshot.exists()) {
            return res.status(404).json({ 
                error: 'Order not found',
                message: 'No order found with the provided ID' 
            });
        }

        // Get the first (and should be only) order with this ID
        let order = null;
        snapshot.forEach((childSnapshot) => {
            order = {
                firebaseKey: childSnapshot.key,
                ...childSnapshot.val()
            };
            return true; // Stop after first match
        });

        console.log(`Found order:`, order);
        
        return res.status(200).json({ 
            success: true,
            order: order
        });

    } catch (error) {
        console.error('Error fetching order:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch order',
            message: error.message 
        });
    }
} 
