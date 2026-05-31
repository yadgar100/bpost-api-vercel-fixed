const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bpost-secret-2024-secure-key';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token)
        return res.status(401).json({ success: false, error: 'Access token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
};

// GET all adjustments (admin gets all, employee gets own)
router.get('/adjustments', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let query;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT FA.Id, FA.EmployeeId, FA.Type, FA.Amount, FA.Reason, FA.Date, FA.Hours, FA.CreatedBy, FA.CreatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM FinancialAdjustments FA
                LEFT JOIN Employees E ON FA.EmployeeId = E.Id
                ORDER BY FA.CreatedAt DESC`;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT FA.Id, FA.EmployeeId, FA.Type, FA.Amount, FA.Reason, FA.Date, FA.Hours, FA.CreatedBy, FA.CreatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM FinancialAdjustments FA
                LEFT JOIN Employees E ON FA.EmployeeId = E.Id
                WHERE FA.EmployeeId = @empId
                ORDER BY FA.CreatedAt DESC`;
        }
        const rows = await request.query(query);
        res.json({ success: true, adjustments: rows.recordset });
    } catch (error) {
        console.error('GET adjustments error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create adjustment
router.post('/adjustments', authenticateToken, async (req, res) => {
    try {
        const { employeeId, type, amount, reason, date, hours } = req.body;
        if (!employeeId || !type || !amount || !date)
            return res.status(400).json({ success: false, error: 'Missing required fields: employeeId, type, amount, date' });

        const pool = await req.app.locals.getPool();
        const inserted = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('type', sql.VarChar(50), type)
            .input('amount', sql.Decimal(10, 2), parseFloat(amount))
            .input('reason', sql.NVarChar(500), reason || '')
            .input('date', sql.Date, date)
            .input('hours', sql.Decimal(5, 2), hours ? parseFloat(hours) : null)
            .input('createdBy', sql.Int, req.user.id)
            .query(`
                INSERT INTO FinancialAdjustments (EmployeeId, Type, Amount, Reason, Date, Hours, CreatedBy, CreatedAt)
                OUTPUT INSERTED.*
                VALUES (@employeeId, @type, @amount, @reason, @date, @hours, @createdBy, GETDATE())
            `);
        res.status(201).json({ success: true, adjustment: inserted.recordset[0], message: 'Adjustment created successfully' });
    } catch (error) {
        console.error('POST adjustment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// PUT update adjustment (used for approving account_credit_pending → account_credit)
router.put('/adjustments/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin access required' });
        const { type, amount, reason, date, employeeId } = req.body;
        const pool = await req.app.locals.getPool();
        const updated = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('type', sql.VarChar(50), type)
            .input('amount', sql.Decimal(10, 2), parseFloat(amount))
            .input('reason', sql.NVarChar(500), reason || '')
            .input('date', sql.Date, date)
            .query(`
                UPDATE FinancialAdjustments
                SET Type = @type, Amount = @amount, Reason = @reason, Date = @date
                OUTPUT INSERTED.*
                WHERE Id = @id
            `);
        if (updated.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Adjustment not found' });
        res.json({ success: true, adjustment: updated.recordset[0], message: 'Updated successfully' });
    } catch (error) {
        console.error('PUT adjustment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE adjustment
router.delete('/adjustments/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const deleted = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM FinancialAdjustments OUTPUT DELETED.* WHERE Id = @id');
        if (deleted.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Adjustment not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;