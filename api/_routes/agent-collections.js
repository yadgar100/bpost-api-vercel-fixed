const express = require('express');
const router  = express.Router();
const sql     = require('mssql');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bpost-secret-2024-secure-key';

const auth = (req, res, next) => {
    const header = req.headers['authorization'];
    const token  = header && header.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Access token required' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { return res.status(401).json({ success: false, error: 'Invalid or expired token' }); }
};

// ── GET all collections (admin) or own (employee) ─────────────────────────────
// NOTE: No filter by agent-employee assignment — returns ALL records.
// Assignment is used only for limiting which agents an employee can SELECT,
// not for filtering what collections are visible in reports.
router.get('/agent-collections', auth, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let where = '';

        if (!req.user.isAdmin && req.user.isAdmin != 1) {
            request.input('empId', sql.Int, req.user.id);
            where = 'WHERE AC.EmployeeId = @empId';
        }

        const result = await request.query(`
            SELECT
                AC.Id,
                AC.EmployeeId,
                AC.AgentId,
                AC.Date,
                AC.FromCode,
                AC.ToCode,
                AC.AmountCollected,
                AC.AmountPaid,
                AC.BankAmount,
                AC.BoxesQty,
                AC.Notes,
                AC.CreatedAt,
                ISNULL(AC.Currency, 'GBP')  AS Currency,
                E.FirstName,
                E.LastName,
                E.EmployeeId                AS EmployeeCode,
                A.AgentCode,
                A.City
            FROM AgentCollections AC
            LEFT JOIN Employees E ON AC.EmployeeId = E.Id
            LEFT JOIN Agents    A ON AC.AgentId    = A.Id
            ${where}
            ORDER BY AC.Date DESC, AC.CreatedAt DESC
        `);

        res.json({ success: true, collections: result.recordset });
    } catch (err) {
        console.error('GET agent-collections error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET agent-collections for currently logged-in employee ────────────────────
router.get('/agent-collections/my', auth, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('empId', sql.Int, req.user.id)
            .query(`
                SELECT
                    AC.Id, AC.EmployeeId, AC.AgentId,
                    AC.Date, AC.FromCode, AC.ToCode,
                    AC.AmountCollected, AC.AmountPaid, AC.BankAmount,
                    AC.BoxesQty, AC.Notes, AC.CreatedAt,
                    ISNULL(AC.Currency, 'GBP') AS Currency,
                    E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                    A.AgentCode, A.City
                FROM AgentCollections AC
                LEFT JOIN Employees E ON AC.EmployeeId = E.Id
                LEFT JOIN Agents    A ON AC.AgentId    = A.Id
                WHERE AC.EmployeeId = @empId
                ORDER BY AC.Date DESC
            `);
        res.json({ success: true, collections: result.recordset });
    } catch (err) {
        console.error('GET agent-collections/my error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST — create a new collection record ─────────────────────────────────────
router.post('/agent-collections', auth, async (req, res) => {
    try {
        const {
            agentId, date,
            fromCode, toCode,
            amountCollected, amountPaid, bankAmount,
            boxesQty, notes, currency
        } = req.body;

        // For employees, ALWAYS use their own JWT id. Admins can specify any employeeId.
        let employeeId;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            employeeId = req.body.employeeId;
            if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId is required (admin)' });
        } else {
            employeeId = req.user.id;
        }

        if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });
        if (!date)    return res.status(400).json({ success: false, error: 'date is required' });

        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('employeeId',      sql.Int,           parseInt(employeeId))
            .input('agentId',         sql.Int,           parseInt(agentId))
            .input('date',            sql.Date,          new Date(date))
            .input('fromCode',        sql.NVarChar(100), fromCode    || '')
            .input('toCode',          sql.NVarChar(100), toCode      || '')
            .input('amountCollected', sql.Decimal(18,2), parseFloat(amountCollected) || 0)
            .input('amountPaid',      sql.Decimal(18,2), parseFloat(amountPaid)      || 0)
            .input('bankAmount',      sql.Decimal(18,2), parseFloat(bankAmount)      || 0)
            .input('boxesQty',        sql.Int,           parseInt(boxesQty)          || 0)
            .input('notes',           sql.NVarChar(500), notes    || '')
            .input('currency',        sql.NVarChar(10),  currency || 'GBP')
            .query(`
                INSERT INTO AgentCollections
                    (EmployeeId, AgentId, Date, FromCode, ToCode,
                     AmountCollected, AmountPaid, BankAmount, BoxesQty, Notes, Currency)
                OUTPUT
                    INSERTED.Id,
                    INSERTED.EmployeeId,
                    INSERTED.AgentId,
                    INSERTED.Date,
                    INSERTED.FromCode,
                    INSERTED.ToCode,
                    INSERTED.AmountCollected,
                    INSERTED.AmountPaid,
                    INSERTED.BankAmount,
                    INSERTED.BoxesQty,
                    INSERTED.Notes,
                    INSERTED.Currency,
                    INSERTED.CreatedAt
                VALUES
                    (@employeeId, @agentId, @date, @fromCode, @toCode,
                     @amountCollected, @amountPaid, @bankAmount, @boxesQty, @notes, @currency)
            `);

        res.status(201).json({ success: true, collection: result.recordset[0] });
    } catch (err) {
        console.error('POST agent-collections error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PUT — edit a collection record ────────────────────────────────────────────
router.put('/agent-collections/:id', auth, async (req, res) => {
    try {
        const {
            fromCode, toCode,
            amountCollected, amountPaid, bankAmount,
            boxesQty, notes, employeeId, agentId, date, currency
        } = req.body;

        const pool = await req.app.locals.getPool();
        const isAdmin = (req.user.isAdmin == true || req.user.isAdmin == 1);

        // Non-admin must own the record they're editing
        if (!isAdmin) {
            const own = await pool.request()
                .input('id',    sql.Int, parseInt(req.params.id))
                .input('empId', sql.Int, req.user.id)
                .query('SELECT EmployeeId FROM AgentCollections WHERE Id = @id');
            if (!own.recordset.length)                          return res.status(404).json({ success: false, error: 'Record not found' });
            if (own.recordset[0].EmployeeId !== req.user.id)    return res.status(403).json({ success: false, error: 'You can only edit your own records' });
        }

        const request = pool.request().input('id', sql.Int, parseInt(req.params.id));
        const fields = ['UpdatedAt = GETDATE()'];

        if (fromCode        !== undefined) { fields.push('FromCode = @fromCode');               request.input('fromCode',        sql.NVarChar(100), fromCode); }
        if (toCode          !== undefined) { fields.push('ToCode = @toCode');                   request.input('toCode',          sql.NVarChar(100), toCode); }
        if (amountCollected !== undefined) { fields.push('AmountCollected = @amountCollected'); request.input('amountCollected', sql.Decimal(18,2), parseFloat(amountCollected)||0); }
        if (amountPaid      !== undefined) { fields.push('AmountPaid = @amountPaid');           request.input('amountPaid',      sql.Decimal(18,2), parseFloat(amountPaid)||0); }
        if (bankAmount      !== undefined) { fields.push('BankAmount = @bankAmount');           request.input('bankAmount',      sql.Decimal(18,2), parseFloat(bankAmount)||0); }
        if (boxesQty        !== undefined) { fields.push('BoxesQty = @boxesQty');               request.input('boxesQty',        sql.Int,           parseInt(boxesQty)||0); }
        if (notes           !== undefined) { fields.push('Notes = @notes');                     request.input('notes',           sql.NVarChar(500), notes); }
        if (agentId         !== undefined) { fields.push('AgentId = @agentId');                 request.input('agentId',         sql.Int,           parseInt(agentId)); }
        if (date            !== undefined) { fields.push('Date = @date');                       request.input('date',            sql.Date,          new Date(date)); }
        if (currency        !== undefined) { fields.push('Currency = @currency');               request.input('currency',        sql.NVarChar(10),  currency); }

        // Only admin may reassign to another employee
        if (isAdmin && employeeId !== undefined) {
            fields.push('EmployeeId = @employeeId');
            request.input('employeeId', sql.Int, parseInt(employeeId));
        }

        const updated = await request.query(
            `UPDATE AgentCollections SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`
        );

        if (!updated.recordset.length) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, collection: updated.recordset[0] });
    } catch (err) {
        console.error('PUT agent-collections error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE — remove a collection record ───────────────────────────────────────
router.delete('/agent-collections/:id', auth, async (req, res) => {
    try {
        if (!req.user.isAdmin && req.user.isAdmin != 1)
            return res.status(403).json({ success: false, error: 'Admin only' });

        const pool = await req.app.locals.getPool();
        await pool.request()
            .input('id', sql.Int, parseInt(req.params.id))
            .query('DELETE FROM AgentCollections WHERE Id = @id');

        res.json({ success: true, message: 'Collection record deleted' });
    } catch (err) {
        console.error('DELETE agent-collections error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;