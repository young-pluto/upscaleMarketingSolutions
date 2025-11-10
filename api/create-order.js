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
        const { amount, currency = 'USD' } = req.body;

        if (!amount || amount < 10 || amount > 1000) {
            return res.status(400).json({ 
                error: 'Invalid amount. Amount must be between $10 and $1000' 
            });
        }

        // Initialize PayPal client
        const client = new Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: process.env.PAYPAL_CLIENT_ID,
                oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
            },
            timeout: 0,
            environment: Environment.Production, // Live environment
            logging: {
                logLevel: LogLevel.Info,
                logRequest: { logBody: true },
                logResponse: { logHeaders: true },
            },
        });

        const ordersController = new OrdersController(client);

        const createOrderRequest = {
            body: {
                intent: "CAPTURE",
                purchaseUnits: [
                    {
                        amount: {
                            currencyCode: currency,
                            value: amount.toString(),
                            breakdown: {
                                itemTotal: {
                                    currencyCode: currency,
                                    value: amount.toString(),
                                },
                            },
                        },
                        items: [
                            {
                                name: "YouTube Promotion Package",
                                unitAmount: {
                                    currencyCode: currency,
                                    value: amount.toString(),
                                },
                                quantity: "1",
                                description: `Professional YouTube promotion service - $${amount} package`,
                                sku: `youtube-promo-${amount}`,
                                category: "DIGITAL_GOODS"
                            },
                        ],
                        description: "YouTube channel promotion and marketing services",
                        customId: `youtube-promo-${Date.now()}`,
                        invoiceId: `INV-${Date.now()}`,
                        softDescriptor: "YOUTUBE PROMO"
                    },
                ],
                applicationContext: {
                    brandName: "Upscale Marketing Solutions",
                    landingPage: "BILLING",
                    userAction: "PAY_NOW",
                    returnUrl: `${req.headers.origin || 'https://your-domain.com'}/success`,
                    cancelUrl: `${req.headers.origin || 'https://your-domain.com'}/cancel`
                }
            },
            prefer: "return=representation",
        };

        const { body, ...httpResponse } = await ordersController.createOrder(createOrderRequest);
        
        const orderData = JSON.parse(body);
        
        return res.status(httpResponse.statusCode).json(orderData);

    } catch (error) {
        console.error('Create order error:', error);
        
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({
                error: error.message,
                details: error.result
            });
        }
        
        return res.status(500).json({ 
            error: 'Failed to create order',
            message: error.message 
        });
    }
}