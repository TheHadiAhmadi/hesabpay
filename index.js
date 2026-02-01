import express from 'express';
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto'
import { fileURLToPath } from 'url';

// Setup for static paths in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function encryptPin(pin, encryptionKey) {
    // Note: createCipher is deprecated in newer Node versions but required by some older APIs.
    // If HesabPay requires it specifically as per docs:
    const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
    let encrypted = cipher.update(pin, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
}
async function distributeToVendors(amount) {
    console.log("🔄 Starting Multi-Vendor Distribution...");

    const apiKey = process.env.HESABPAY_API_KEY;
    const pin = process.env.HESABPAY_PIN;

    if (!pin) {
        console.error("❌ No PIN found in .env");
        return { success: false, message: "Server PIN missing" };
    }

    try {
        const encryptedPin = encryptPin(pin, apiKey);

        // Define Vendors
        // You mentioned "all vendors is myself (+93787771034)"
        // We format it to local 078... format
        const vendors = [
            { 
                "account_number": "0787771034", 
                "amount": amount - 10 // sending the full amount for this test
            },
            { 
                "account_number": "0787771034", 
                "amount": 10 // sending the full amount for this test
            }
        ];

        const payload = {
            "pin": encryptedPin,
            "vendors": vendors
        };

        const response = await fetch('https://api.hesab.com/api/v1/payment/send-money-MultiVendor', {
            method: "POST",
            headers: {
                'Authorization': `API-KEY ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("✅ Vendor Distribution Response:", data);
        return data;

    } catch (error) {
        console.error("❌ Vendor Distribution Error:", error);
        return { success: false, error: error.message };
    }
}
// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve the UI files

// --- DATABASE HELPER FUNCTIONS ---

// Initialize DB if it doesn't exist
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

async function updateOrderStatus(orderId, status, transactionId) {
    const db = await getOrders();
    const orderIndex = db.orders.findIndex(o => o.id === orderId);
    
    if (orderIndex > -1) {
        db.orders[orderIndex].status = status;
        db.orders[orderIndex].updatedAt = new Date().toISOString();
        if(transactionId) {
	    db.orders[orderIndex].transactionId = transactionId
	}
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        return db.orders[orderIndex];
    }
    return null;
}

// Initialize DB on start
initDB();

// --- ROUTES ---

// 1. Create Payment
app.post("/payments/create", async (req, res) => {
    try {
        const orderId = "ORD-" + Date.now(); // Generate simple Order ID
        const amount = 45;
        
        // 1. Save "Pending" Order to DB
        await saveOrder({
            id: orderId,
            amount: amount,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            items: req.body.items || []
        });

        // 2. Call HesabPay API
        // Note: We append ?order_id to the callback URLs to track which user paid
        const payload = {
            "email": "customer@example.com",
            "items": [
                { "id": "item1", "name": "Product Name", "price": amount }
            ],
            "redirect_success_url": `http://localhost:${PORT}/payments/callback/success?order_id=${orderId}`,
            "redirect_failure_url": `http://localhost:${PORT}/payments/callback/failure?order_id=${orderId}`
        };

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

        console.log("HesabPay Response:", data);

        if (data.url) {
            // Send the URL back to frontend so it can redirect
            res.json({ success: true, payment_url: data.url });
        } else {
            res.status(400).json({ success: false, message: "Failed to create session" });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 2. Callback Success (User is redirected here by HesabPay)
// Note: Usually redirects are GET requests. 
app.get("/payments/callback/success", async (req, res) => {
    const orderId = req.query.order_id;
	const data = JSON.parse(req.query.data)
    
    console.log(`Payment Successful for Order: ${orderId}`);

    // Update DB
    if (orderId) {
        await updateOrderStatus(orderId, 'PAID');
    }

    // Serve the Success UI
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// 3. Callback Failure
app.get("/payments/callback/failure", async (req, res) => {
    const orderId = req.query.order_id;

    console.log(`Payment Failed for Order: ${orderId}`);

    if (orderId) {
        await updateOrderStatus(orderId, 'FAILED');
    }

    // Serve the Failure UI
    res.sendFile(path.join(__dirname, 'public', 'failure.html'));
});

// 4. API to check DB (For testing purposes)
app.get("/api/orders", async (req, res) => {
    const db = await getOrders();
    res.json(db);
});

app.listen(PORT, () => console.log("Server started on http://localhost:" + PORT));

