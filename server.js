import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Import API routes
import createOrder from './api/create-order.js';
import captureOrder from './api/capture-order.js';
import submitOrder from './api/submit-order.js';
import getOrders from './api/get-orders.js';
import getOrder from './api/get-order.js';

// API routes
app.post('/api/create-order', createOrder);
app.post('/api/capture-order', captureOrder);
app.post('/api/submit-order', submitOrder);
app.get('/api/get-orders', getOrders);
app.get('/api/get-order', getOrder);

// Serve static files - ROUTES FIRST
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/youtube-promotion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}); 
