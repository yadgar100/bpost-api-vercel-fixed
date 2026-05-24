const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();

// Raw CORS headers — must be absolute first middleware
app.use(function(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', credentials: false }));

const dbConfig = {
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeout: 8000,
    requestTimeout: 8000,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: { max: 3, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise;
const getPool = async () => {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(dbConfig).connect();
    }
    return poolPromise;
};
app.locals.getPool = getPool;

const authRoutes = require('./_routes/auth');
const employeeRoutes = require('./_routes/employees');
const locationRoutes = require('./_routes/locations');
const timesheetRoutes = require('./_routes/timesheets');
const adjustmentRoutes = require('./_routes/adjustments');
const vehicleRoutes = require('./_routes/vehicles');
const expenseRoutes = require('./_routes/expenses');
const agentRoutes = require('./_routes/agents');
const iraqPayRoutes = require('./_routes/iraqpay');

app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', locationRoutes);
app.use('/api', timesheetRoutes);
app.use('/api', adjustmentRoutes);
app.use('/api', vehicleRoutes);
app.use('/api', expenseRoutes);
app.use('/api', agentRoutes);
app.use('/api', iraqPayRoutes);

app.get('/api/health', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request().query('SELECT 1 AS alive');
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error) {
        poolPromise = null;
        res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
    }
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

module.exports = app;