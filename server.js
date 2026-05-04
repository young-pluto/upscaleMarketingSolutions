import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json());

// Import API routes
import createOrder from './api/create-order.js';
import captureOrder from './api/capture-order.js';
import submitOrder from './api/submit-order.js';
import getOrders from './api/get-orders.js';
import getOrder from './api/get-order.js';
import submitTrialCampaign from './api/submit-trial-campaign.js';
import getTrialCampaigns from './api/get-trial-campaigns.js';

// API routes
app.post('/api/create-order', createOrder);
app.post('/api/capture-order', captureOrder);
app.post('/api/submit-order', submitOrder);
app.get('/api/get-orders', getOrders);
app.get('/api/get-order', getOrder);
app.post('/api/submit-trial-campaign', submitTrialCampaign);
app.get('/api/get-trial-campaigns', getTrialCampaigns);

// Serve static files - ROUTES FIRST
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/youtube-promotion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/trial-campaign', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trial-campaign.html'));
});

app.get('/trial-campaign-intake', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trial-campaign-intake.html'));
});

app.get('/trial-campaign-success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trial-campaign-success.html'));
});

app.get('/campaign-progress', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'campaign-progress.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect(301, '/youtube-promotion');
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Static files AFTER routes
app.use(express.static('public'));

app.listen(PORT, HOST, () => {
    const networkInterfaces = os.networkInterfaces();
    const localAddresses = Object.values(networkInterfaces)
        .flat()
        .filter((details) => details && details.family === 'IPv4' && !details.internal)
        .map((details) => details.address);

    console.log(`Server running on http://localhost:${PORT}`);

    if (localAddresses.length > 0) {
        localAddresses.forEach((address) => {
            console.log(`LAN access available at http://${address}:${PORT}`);
        });
    }
}); 
