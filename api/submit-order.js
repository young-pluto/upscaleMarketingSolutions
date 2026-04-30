import { admin, getDatabase } from './_firebase-admin.js';

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
