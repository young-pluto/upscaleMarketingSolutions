import {
    ApiError,
    Client,
    Environment,
    LogLevel,
    OrdersController,
} from "@paypal/paypal-server-sdk";

export default async function handler(req, res) {
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
        const { orderID } = req.body;

        if (!orderID) {
            return res.status(400).json({ 
                error: 'Missing orderID' 
            });
        }

        // Initialize PayPal client
        const client = new Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: process.env.PAYPAL_CLIENT_ID,
                oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
            },
            timeout: 0,
            environment: Environment.Production, // Change to Environment.Production for live
            logging: {
                logLevel: LogLevel.Info,
                logRequest: { logBody: true },
                logResponse: { logHeaders: true },
            },
        });

        const ordersController = new OrdersController(client);

        const captureOrderRequest = {
            id: orderID,
            prefer: "return=representation",
        };

        const { body, ...httpResponse } = await ordersController.captureOrder(captureOrderRequest);
        
        const orderData = JSON.parse(body);
        
        // Log successful capture for admin tracking
        console.log('Order captured successfully:', {
            orderID,
            status: orderData.status,
            captureID: orderData.purchase_units?.[0]?.payments?.captures?.[0]?.id,
            amount: orderData.purchase_units?.[0]?.amount?.value,
            timestamp: new Date().toISOString()
        });
        
        return res.status(httpResponse.statusCode).json(orderData);

    } catch (error) {
        console.error('Capture order error:', error);
        
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                error: error.message,
                details: error.result
            });
        }
        
        return res.status(500).json({ 
            error: 'Failed to capture order',
            message: error.message 
        });
    }
}