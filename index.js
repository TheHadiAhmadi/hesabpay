import express from 'express';
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup for static paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// --- DATABASE HELPER FUNCTIONS ---
async function initDB() {
    try {
        await fs.access(DB_PATH);
    } catch {
        const initialData = { orders: [] };
        await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
        await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
    }
}

async function getOrders() {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
}

async function saveOrder(order) {
    const db = await getOrders();
    db.orders.push(order);
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function updateOrderStatus(orderId, status) {
    const db = await getOrders();
    const orderIndex = db.orders.findIndex(o => o.id === orderId);
    
    if (orderIndex > -1) {
        db.orders[orderIndex].status = status;
        db.orders[orderIndex].updatedAt = new Date().toISOString();
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
    }
}

initDB();

// --- ROUTES ---

// 1. Create Payment
app.post("/payments/create", async (req, res) => {
    try {
        const { description, amount } = req.body;
        const orderId = "INV-" + Date.now(); 

        // Save Pending Order
        await saveOrder({
            id: orderId,
            description: description,
            amount: amount,
            currency: 'AFN',
            status: 'PENDING',
            createdAt: new Date().toISOString()
        });

        // HesabPay Payload
        const payload = {
            "currency": "AFN", 
            "items": [
                { 
                    "name": description, 
                    "price": parseFloat(amount),
                    "id": 1
                }
            ],
            "email": "boss@example.com", 
            "redirect_success_url": `${process.env.DOMAIN}/payments/callback/success?order_id=${orderId}`,
            "redirect_failure_url": `${process.env.DOMAIN}/payments/callback/failure?order_id=${orderId}`
        };

        // Call HesabPay API
        const response = await fetch('https://api.hesab.com/api/v1/payment/create-session', {
            method: "POST",
            headers: {
                'Authorization': `API-KEY ${process.env.HESABPAY_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("HesabPay Response:", JSON.stringify(data));

        if (data.url) {
            res.json({ success: true, payment_url: data.url });
        } else {
            // Log the error for debugging
            console.error("API Error:", data); 
            res.status(400).json({ success: false, message: "Could not generate invoice link." });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 2. Success Callback
app.get("/payments/callback/success", async (req, res) => {
    const orderId = req.query.order_id;
    console.log(`Payment Successful for Order: ${orderId}`);

    if (orderId) {
        await updateOrderStatus(orderId, 'PAID');
    }
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// 3. Failure Callback
app.get("/payments/callback/failure", async (req, res) => {
    const orderId = req.query.order_id;
    console.log(`Payment Failed for Order: ${orderId}`);

    if (orderId) {
        await updateOrderStatus(orderId, 'FAILED');
    }
    res.sendFile(path.join(__dirname, 'public', 'failure.html'));
});

app.listen(PORT, () => console.log(`Invoice App running on http://localhost:${PORT}`));
