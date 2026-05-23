const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bpost-secret-2024-secure-key';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Access token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; 
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
};

// GET all (admin) or own (employee)
router.get('/iraq-pay', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let query;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT IP.*, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM IraqPayments IP
                LEFT JOIN Employees E ON IP.EmployeeId = E.Id
                ORDER BY IP.CreatedAt DESC`;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT IP.*, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM IraqPayments IP
                LEFT JOIN Employees E ON IP.EmployeeId = E.Id
                WHERE IP.EmployeeId = @empId
                ORDER BY IP.CreatedAt DESC`;
        }
        const rows = await request.query(query);
        res.json({ success: true, payments: rows.recordset });
    } catch (error) {
        console.error('GET iraq-pay error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST batch upload (admin only) — receives array of records
router.post('/iraq-pay/batch', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin only' });
        const { batchName, employeeId, records } = req.body;
        if (!batchName || !employeeId || !records || !records.length)
            return res.status(400).json({ success: false, error: 'batchName, employeeId, and records are required' });

        const pool = await req.app.locals.getPool();
        const inserted = [];
        for (const rec of records) {
            const result = await pool.request()
                .input('batchName',    sql.NVarChar(200),  batchName)
                .input('shipmentCode', sql.NVarChar(100),  rec.shipmentCode || '')
                .input('employeeId',   sql.Int,            parseInt(employeeId))
                .input('amtIQD',       sql.Decimal(18,2),  parseFloat(rec.amountIQD)  || 0)
                .input('amtUSD',       sql.Decimal(18,2),  parseFloat(rec.amountUSD)  || 0)
                .input('amtGBP',       sql.Decimal(18,2),  parseFloat(rec.amountGBP)  || 0)
                .input('amtEUR',       sql.Decimal(18,2),  parseFloat(rec.amountEUR)  || 0)
                .input('notes',        sql.NVarChar(500),  rec.notes || '')
                .query(`INSERT INTO IraqPayments
                    (BatchName, ShipmentCode, EmployeeId, AmountIQD, AmountUSD, AmountGBP, AmountEUR, Notes)
                    OUTPUT INSERTED.*
                    VALUES (@batchName, @shipmentCode, @employeeId, @amtIQD, @amtUSD, @amtGBP, @amtEUR, @notes)`);
            inserted.push(result.recordset[0]);
        }
        res.status(201).json({ success: true, inserted: inserted.length, payments: inserted });
    } catch (error) {
        console.error('POST iraq-pay/batch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST single record (admin)
router.post('/iraq-pay', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin only' });
        const { batchName, shipmentCode, employeeId, amountIQD, amountUSD, amountGBP, amountEUR, notes } = req.body;
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('batchName',    sql.NVarChar(200),  batchName || 'Manual')
            .input('shipmentCode', sql.NVarChar(100),  shipmentCode || '')
            .input('employeeId',   sql.Int,            parseInt(employeeId))
            .input('amtIQD',       sql.Decimal(18,2),  parseFloat(amountIQD)  || 0)
            .input('amtUSD',       sql.Decimal(18,2),  parseFloat(amountUSD)  || 0)
            .input('amtGBP',       sql.Decimal(18,2),  parseFloat(amountGBP)  || 0)
            .input('amtEUR',       sql.Decimal(18,2),  parseFloat(amountEUR)  || 0)
            .input('notes',        sql.NVarChar(500),  notes || '')
            .query(`INSERT INTO IraqPayments
                (BatchName, ShipmentCode, EmployeeId, AmountIQD, AmountUSD, AmountGBP, AmountEUR, Notes)
                OUTPUT INSERTED.*
                VALUES (@batchName, @shipmentCode, @employeeId, @amtIQD, @amtUSD, @amtGBP, @amtEUR, @notes)`);
        res.status(201).json({ success: true, payment: result.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT — employee records collection, or admin edits
router.put('/iraq-pay/:id', authenticateToken, async (req, res) => {
    try {
        const { collectedIQD, collectedUSD, collectedGBP, collectedEUR, notes, status, employeeId, amountIQD, amountUSD, amountGBP, amountEUR } = req.body;
        const pool = await req.app.locals.getPool();
        const request = pool.request().input('id', sql.Int, req.params.id);
        const fields = ['UpdatedAt = GETDATE()'];

        if (collectedIQD !== undefined) { fields.push('CollectedIQD = @cIQD'); request.input('cIQD', sql.Decimal(18,2), parseFloat(collectedIQD)||0); }
        if (collectedUSD !== undefined) { fields.push('CollectedUSD = @cUSD'); request.input('cUSD', sql.Decimal(18,2), parseFloat(collectedUSD)||0); }
        if (collectedGBP !== undefined) { fields.push('CollectedGBP = @cGBP'); request.input('cGBP', sql.Decimal(18,2), parseFloat(collectedGBP)||0); }
        if (collectedEUR !== undefined) { fields.push('CollectedEUR = @cEUR'); request.input('cEUR', sql.Decimal(18,2), parseFloat(collectedEUR)||0); }
        if (notes !== undefined)        { fields.push('Notes = @notes');        request.input('notes', sql.NVarChar(500), notes); }
        if (status)                     { fields.push('Status = @status');      request.input('status', sql.NVarChar(20), status); }
        if (employeeId !== undefined)   { fields.push('EmployeeId = @empId');   request.input('empId', sql.Int, parseInt(employeeId)); }
        if (amountIQD !== undefined)    { fields.push('AmountIQD = @aIQD');     request.input('aIQD', sql.Decimal(18,2), parseFloat(amountIQD)||0); }
        if (amountUSD !== undefined)    { fields.push('AmountUSD = @aUSD');     request.input('aUSD', sql.Decimal(18,2), parseFloat(amountUSD)||0); }
        if (amountGBP !== undefined)    { fields.push('AmountGBP = @aGBP');     request.input('aGBP', sql.Decimal(18,2), parseFloat(amountGBP)||0); }
        if (amountEUR !== undefined)    { fields.push('AmountEUR = @aEUR');     request.input('aEUR', sql.Decimal(18,2), parseFloat(amountEUR)||0); }

        // Auto-set CollectedAt when status becomes collected
        if (status === 'collected') { fields.push("CollectedAt = GETDATE()"); }

        const updated = await request.query(
            `UPDATE IraqPayments SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`
        );
        if (updated.recordset.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, payment: updated.recordset[0] });
    } catch (error) {
        console.error('PUT iraq-pay error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE (admin only)
router.delete('/iraq-pay/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin only' });
        const pool = await req.app.locals.getPool();
        await pool.request().input('id', sql.Int, req.params.id)
            .query('DELETE FROM IraqPayments WHERE Id = @id');
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;