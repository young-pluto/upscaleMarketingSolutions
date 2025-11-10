import admin from 'firebase-admin';

let database = null;

// Initialize Firebase Admin if not already initialized
function initializeFirebase() {
    if (!admin.apps.length) {
        const serviceAccount = {
            type: "service_account",
            project_id: "slot-booking-c28d8",
            private_key_id: "4b3922321927221c3bdc8b306e0159e07ce3dca4",
            private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCrlli4+OruoejI\njKHwvxQlEiRHmUvySv1WplTeVcZBRyam1LVNa1AJ5IbD5JJF9JR12ZnHaz+JFCUv\no07F//rbBiDHWRlzeKOUS3GO00z45qoZE9rqhzfzCrlOQg5m5xeUX1NB20hpq16N\ns5sUspFl0xaKtyfG7/gQnmGdKl/oteLbty+2Um09ljTB6IfLF3H9GKsPU9g7EQIL\nCQr97mG6wH7lbdZWwuzefu54WnXF39TGKzwb4RqvOOzCOjeVY6ngu3VyiATkKtDy\ndhR4+aTVAyyPJE2fNzTEU10uqxQFiXGUWZE0D/5eBGTrB+6ujAvIaITPJCI+otMs\npwqagmmFAgMBAAECggEAA/YXnEWa3uF8B00/29f9dhGiJskCONjEWoDCitN+HTmw\nSb+1Y9Erat8MwW8AdX79Am+Anlr6f4aoiR4DDo0nVHEixpdnAARz+lN3jq2QJFrm\n6GdN8YYno4PG3Wim/nctUy6UNHwEgvQC3dCcrvCkbK5f4dnyoCQgHPobFM7Koguv\nNa0RbetckS/HDfFldkzrhPv4P/mqeLbVu5WH6Igeg5kn7q460FrFx8uD1tehis2/\nbgyOHz1zDoB4fekEovvjhotssyKjpbqlSvpPAme7Ks87dGZ0CcgmL7HkzlE0ZCOL\nWSjCC8D+d8xEJxjqkk+Tmx/S42bTN5Y8cCcs2m04bQKBgQDmUoe6jeTzd1Kibzhq\nq/eSHKmZtrYBA1TW9ANl3yZsy3ZySDzVrHwqUXRS9PMZIkCTrTv4fv9jpvOvUTv2\nzonVtjCtJ8IFTiJmrBO7ggT4fApppg+IZwuM+fM8GGQWnI78Iu4FG2UPG0heFup1\nCp/tJu3r5T1QrjDKzIYVLLPfnwKBgQC+t3/PWAIe0jgGcRFV2t9FPm0qvEouH1F/\nHI+hDIC3OXRtwzvqvUv7ebPeoBaWme25Q5NcAyayz3/IzEZotSpIKgr+rglgeboS\nWsFws30e+U5U/hPZpyJa1K7kTvUlc9FuDGO6tYJ1TXBnCsFRKbwUstV0qqtTGhkH\ndrKjmnaUWwKBgHoYyicVTYfbe4zslOXHoAhu9WGtQDKtR25kEOESONZ3zaSrssQ7\nGd99KsNHYw+x3rXqod4LxOtY99m6oKUnvF30pT1F1E7nqsju8871EBmB+Cslgxp2\nNeNYJZ939qcd+5aiFbfTW/F0Lxrh3wyIw1r+xiXFcomwreD0JyhWeExVAoGAH2fI\nPDSZ5MlpQGZOHH02Vwi4oVjwPjgaC3yAilystX9YlNqZe0ZAxOB9piNmlNY0N1XR\nZk1+ieNxf3dkAMoUdF24AchW8vQYl/0p7Y0hBYC4TXapfiXvmlV7l00JQWmZCy4v\nHgfVu8tMvyseOmdM+XuZeuS/4adih8AcGqTM8hECgYEAziGQ+lDGT52xtH3Itnq1\n8sb54r0ihYLfmmWxliAVICYT1FodOd0DFEDB7TOTOD8SpT/5JHThLUPpSvVo6Cvq\nFceeDopyycw4b/ARgp2OllbqWXS/Jeh3onLa3FvDV6w6id84FwDHWXOLRT/Trrg0\nEL49iOLVsN9Gmn7mRBA2moc=\n-----END PRIVATE KEY-----\n",
            client_email: "firebase-adminsdk-jpoyi@slot-booking-c28d8.iam.gserviceaccount.com",
            client_id: "104411987002100576470",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
        };

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://slot-booking-c28d8-default-rtdb.firebaseio.com/"
        });
    }
    
    if (!database) {
        database = admin.database();
    }
}

export default async function handler(req, res) {
    // Initialize Firebase if needed
    initializeFirebase();
    
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