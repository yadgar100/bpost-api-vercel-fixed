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

// GET all agents with their assigned employees
router.get('/agents', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const agents = await pool.request().query(`
            SELECT A.Id, A.AgentCode, A.City, A.Country, A.Notes, A.IsActive, A.CreatedAt
            FROM Agents A WHERE A.IsActive = 1 ORDER BY A.AgentCode
        `);
        const assignments = await pool.request().query(`
            SELECT AA.AgentId, AA.EmployeeId, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
            FROM AgentAssignments AA
            INNER JOIN Employees E ON AA.EmployeeId = E.Id
        `);
        const agentMap = {};
        agents.recordset.forEach(a => { agentMap[a.Id] = { ...a, assignedEmployees: [] }; });
        assignments.recordset.forEach(a => {
            if (agentMap[a.AgentId]) {
                agentMap[a.AgentId].assignedEmployees.push({
                    id: a.EmployeeId,
                    name: `${a.FirstName} ${a.LastName}`,
                    code: a.EmployeeCode
                });
            }
        });
        res.json({ success: true, agents: Object.values(agentMap) });
    } catch (error) {
        console.error('GET agents error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET agents assigned to the current employee
router.get('/agents/my', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rows = await pool.request()
            .input('empId', sql.Int, req.user.id)
            .query(`
                SELECT A.Id, A.AgentCode, A.City, A.Country, A.Notes
                FROM Agents A
                INNER JOIN AgentAssignments AA ON A.Id = AA.AgentId
                WHERE AA.EmployeeId = @empId AND A.IsActive = 1
                ORDER BY A.AgentCode
            `);
        res.json({ success: true, agents: rows.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create agent (admin only)
router.post('/agents', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin access required' });
        const { agentCode, city, country, notes } = req.body;
        if (!agentCode || !city) return res.status(400).json({ success: false, error: 'Agent code and city are required' });
        const pool = await req.app.locals.getPool();
        const inserted = await pool.request()
            .input('agentCode', sql.NVarChar(20), agentCode.toUpperCase().trim())
            .input('city', sql.NVarChar(100), city)
            .input('country', sql.NVarChar(100), country || '')
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`INSERT INTO Agents (AgentCode, City, Country, Notes) OUTPUT INSERTED.* VALUES (@agentCode, @city, @country, @notes)`);
        res.status(201).json({ success: true, agent: inserted.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update agent (admin only)
router.put('/agents/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin access required' });
        const { agentCode, city, country, notes } = req.body;
        const pool = await req.app.locals.getPool();
        const updated = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('agentCode', sql.NVarChar(20), agentCode ? agentCode.toUpperCase().trim() : null)
            .input('city', sql.NVarChar(100), city || '')
            .input('country', sql.NVarChar(100), country || '')
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`UPDATE Agents SET AgentCode = COALESCE(@agentCode, AgentCode), City = @city, Country = @country, Notes = @notes, UpdatedAt = GETDATE() OUTPUT INSERTED.* WHERE Id = @id`);
        if (updated.recordset.length === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
        res.json({ success: true, agent: updated.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE agent (soft delete, admin only)
router.delete('/agents/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin access required' });
        const pool = await req.app.locals.getPool();
        await pool.request().input('id', sql.Int, req.params.id)
            .query(`UPDATE Agents SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id = @id`);
        res.json({ success: true, message: 'Agent removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST assign employees to agent (admin only)
router.post('/agents/:id/assign', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Admin access required' });
        const { employeeIds } = req.body; // array of employee IDs
        const pool = await req.app.locals.getPool();
        const agentId = parseInt(req.params.id);
        // Remove existing assignments for this agent
        await pool.request().input('agentId', sql.Int, agentId)
            .query(`DELETE FROM AgentAssignments WHERE AgentId = @agentId`);
        // Insert new assignments
        for (const empId of (employeeIds || [])) {
            await pool.request()
                .input('agentId', sql.Int, agentId)
                .input('empId', sql.Int, empId)
                .query(`INSERT INTO AgentAssignments (AgentId, EmployeeId) VALUES (@agentId, @empId)`);
        }
        res.json({ success: true, message: 'Assignments updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Collections ---

// GET collections (admin gets all, employee gets own)
router.get('/agent-collections', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let query;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT C.*, A.AgentCode, A.City,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM AgentCollections C
                INNER JOIN Agents A ON C.AgentId = A.Id
                INNER JOIN Employees E ON C.EmployeeId = E.Id
                ORDER BY C.Date DESC, C.CreatedAt DESC`;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT C.*, A.AgentCode, A.City,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode
                FROM AgentCollections C
                INNER JOIN Agents A ON C.AgentId = A.Id
                INNER JOIN Employees E ON C.EmployeeId = E.Id
                WHERE C.EmployeeId = @empId
                ORDER BY C.Date DESC, C.CreatedAt DESC`;
        }
        const rows = await request.query(query);
        res.json({ success: true, collections: rows.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create collection record
router.post('/agent-collections', authenticateToken, async (req, res) => {
    try {
        const { agentId, date, fromCode, toCode, amountCollected, amountPaid, boxesQty, currency, notes } = req.body;
        if (!agentId || amountCollected === undefined) return res.status(400).json({ success: false, error: 'Agent and amount collected are required' });
        const pool = await req.app.locals.getPool();
        const inserted = await pool.request()
            .input('employeeId', sql.Int, req.user.id)
            .input('agentId', sql.Int, agentId)
            .input('date', sql.Date, date || new Date().toISOString().split('T')[0])
            .input('fromCode', sql.NVarChar(30), fromCode || '')
            .input('toCode', sql.NVarChar(30), toCode || '')
            .input('amountCollected', sql.Decimal(12,2), parseFloat(amountCollected) || 0)
            .input('amountPaid', sql.Decimal(12,2), parseFloat(amountPaid) || 0)
            .input('boxesQty', sql.Int, parseInt(boxesQty) || 0)
            .input('currency', sql.NVarChar(10), currency || 'GBP')
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`INSERT INTO AgentCollections (EmployeeId, AgentId, Date, FromCode, ToCode, AmountCollected, AmountPaid, BoxesQty, Currency, Notes)
                    OUTPUT INSERTED.*
                    VALUES (@employeeId, @agentId, @date, @fromCode, @toCode, @amountCollected, @amountPaid, @boxesQty, @currency, @notes)`);
        res.status(201).json({ success: true, collection: inserted.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update collection record
router.put('/agent-collections/:id', authenticateToken, async (req, res) => {
    try {
        const { fromCode, toCode, amountCollected, amountPaid, boxesQty, notes } = req.body;
        const pool = await req.app.locals.getPool();
        const updated = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('fromCode', sql.NVarChar(30), fromCode || '')
            .input('toCode', sql.NVarChar(30), toCode || '')
            .input('amountCollected', sql.Decimal(12,2), parseFloat(amountCollected) || 0)
            .input('amountPaid', sql.Decimal(12,2), parseFloat(amountPaid) || 0)
            .input('boxesQty', sql.Int, parseInt(boxesQty) || 0)
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`UPDATE AgentCollections SET FromCode=@fromCode, ToCode=@toCode, AmountCollected=@amountCollected, AmountPaid=@amountPaid, BoxesQty=@boxesQty, Notes=@notes, UpdatedAt=GETDATE() OUTPUT INSERTED.* WHERE Id=@id`);
        if (updated.recordset.length === 0) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, collection: updated.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE collection record
router.delete('/agent-collections/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        await pool.request().input('id', sql.Int, req.params.id)
            .query(`DELETE FROM AgentCollections WHERE Id = @id`);
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;