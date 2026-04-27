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

// GET all expenses (admin) or own expenses (employee)
router.get('/expenses', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let query;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT E.Id, E.EmployeeId, E.Date, E.Category, E.Description,
                       E.Amount, E.Currency, E.ReceiptNote, E.Status,
                       E.PaidAt, E.PaidBy, E.Notes, E.CreatedAt, E.UpdatedAt,
                       EMP.FirstName, EMP.LastName, EMP.EmployeeId AS EmployeeCode
                FROM ExpenseClaims E
                INNER JOIN Employees EMP ON E.EmployeeId = EMP.Id
                ORDER BY E.Date DESC, E.CreatedAt DESC`;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT E.Id, E.EmployeeId, E.Date, E.Category, E.Description,
                       E.Amount, E.Currency, E.ReceiptNote, E.Status,
                       E.PaidAt, E.PaidBy, E.Notes, E.CreatedAt, E.UpdatedAt,
                       EMP.FirstName, EMP.LastName, EMP.EmployeeId AS EmployeeCode
                FROM ExpenseClaims E
                INNER JOIN Employees EMP ON E.EmployeeId = EMP.Id
                WHERE E.EmployeeId = @empId
                ORDER BY E.Date DESC, E.CreatedAt DESC`;
        }
        const rows = await request.query(query);
        res.json({ success: true, expenses: rows.recordset });
    } catch (error) {
        console.error('GET expenses error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create expense claim
router.post('/expenses', authenticateToken, async (req, res) => {
    try {
        const { date, category, description, amount, currency, receiptNote, employeeId: bodyEmpId } = req.body;
        const employeeId = (req.user.isAdmin == 1 || req.user.isAdmin == true) && bodyEmpId
            ? bodyEmpId : req.user.id;

        if (!date || !amount || !category)
            return res.status(400).json({ success: false, error: 'Date, category and amount are required' });

        const pool = await req.app.locals.getPool();
        const inserted = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('date', sql.Date, date)
            .input('category', sql.NVarChar(50), category)
            .input('description', sql.NVarChar(500), description || '')
            .input('amount', sql.Decimal(10, 2), parseFloat(amount))
            .input('currency', sql.NVarChar(10), currency || 'GBP')
            .input('receiptNote', sql.NVarChar(200), receiptNote || '')
            .query(`
                INSERT INTO ExpenseClaims (EmployeeId, Date, Category, Description, Amount, Currency, ReceiptNote, Status)
                OUTPUT INSERTED.*
                VALUES (@employeeId, @date, @category, @description, @amount, @currency, @receiptNote, 'pending')`);

        res.status(201).json({ success: true, expense: inserted.recordset[0], message: 'Expense submitted successfully' });
    } catch (error) {
        console.error('POST expense error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update expense (admin: approve/reject/pay; employee: edit pending)
router.put('/expenses/:id', authenticateToken, async (req, res) => {
    try {
        const { status, notes, paidBy, category, description, amount, receiptNote } = req.body;
        const pool = await req.app.locals.getPool();
        const request = pool.request().input('id', sql.Int, req.params.id);
        const fields = [];

        if (status) {
            fields.push('Status = @status');
            request.input('status', sql.NVarChar(20), status);
            if (status === 'paid') {
                fields.push('PaidAt = GETDATE()');
                if (paidBy) { fields.push('PaidBy = @paidBy'); request.input('paidBy', sql.NVarChar(100), paidBy); }
            }
        }
        if (notes !== undefined) { fields.push('Notes = @notes'); request.input('notes', sql.NVarChar(500), notes); }
        if (category !== undefined) { fields.push('Category = @category'); request.input('category', sql.NVarChar(50), category); }
        if (description !== undefined) { fields.push('Description = @description'); request.input('description', sql.NVarChar(500), description); }
        if (amount !== undefined) { fields.push('Amount = @amount'); request.input('amount', sql.Decimal(10, 2), parseFloat(amount)); }
        if (receiptNote !== undefined) { fields.push('ReceiptNote = @receiptNote'); request.input('receiptNote', sql.NVarChar(200), receiptNote); }
        fields.push('UpdatedAt = GETDATE()');

        const updated = await request.query(
            `UPDATE ExpenseClaims SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`
        );
        if (updated.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Expense not found' });

        res.json({ success: true, expense: updated.recordset[0], message: 'Updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE expense (employee can delete own pending; admin can delete any)
router.delete('/expenses/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const deleted = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM ExpenseClaims OUTPUT DELETED.* WHERE Id = @id');
        if (deleted.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Expense not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;