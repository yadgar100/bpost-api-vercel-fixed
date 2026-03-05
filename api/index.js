// ============================================
// Vercel Serverless Function Handler
// ============================================

const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();

// ============================================
// Middleware
// ============================================
app.use(express.json());

const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'https://bpost-employees.netlify.app'];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true
}));

// ============================================
// Database Configuration
// ============================================
const dbConfig = {
    server: process.env.DB_SERVER,
    port: 1433,                    // ← add this line
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeout: 8000,
    requestTimeout: 8000,
    options: {
        encrypt: false,            // ← must be false for site4now
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 3,
        min: 0,
        idleTimeoutMillis: 30000
    }
};
// ============================================
// Database Pool
// ============================================
let poolPromise;

const getPool = async () => {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(dbConfig).connect(); // ✅ FIX: Use ConnectionPool directly
    }
    return poolPromise;
};

// ✅ FIX: Use app.locals instead of patching sql.connect
app.locals.getPool = getPool;

// ============================================
// Import Routes
// ✅ FIX: _routes/ (underscore prefix) prevents Vercel treating
//         each file as a separate serverless function entry point
// ============================================
const authRoutes = require('./_routes/auth');
const employeeRoutes = require('./_routes/employees');
const locationRoutes = require('./_routes/locations');
const timesheetRoutes = require('./_routes/timesheets');

// ============================================
// API Routes
// ============================================
app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', locationRoutes);
app.use('/api', timesheetRoutes);

// ============================================
// Health Check
// ============================================
app.get('/api/health', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request().query('SELECT 1 AS alive'); // ✅ FIX: Actually verify DB reachability
        res.json({ 
            status: 'ok', 
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        poolPromise = null; // ✅ FIX: Reset so next request retries fresh
        res.status(500).json({ 
            status: 'error', 
            database: 'disconnected',
            error: error.message 
        });
    }
});

// ============================================
// Error Handling
// ============================================
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        success: false, 
        error: err.message || 'Internal server error'
    });
});

module.exports = app;