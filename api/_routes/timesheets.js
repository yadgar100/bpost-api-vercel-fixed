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

// GET all timesheets (admin sees all, employees see their own)
router.get('/timesheets', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        let query;
        let request = pool.request();

        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT T.Id, T.EmployeeId, T.LocationId, T.Date, T.CheckInTime, T.CheckOutTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes,
                       T.CreatedAt, T.UpdatedAt, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                       L.Name AS LocationName, L.QRCode
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                ORDER BY T.Date DESC, T.CreatedAt DESC
            `;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT T.Id, T.EmployeeId, T.LocationId, T.Date, T.CheckInTime, T.CheckOutTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes,
                       T.CreatedAt, T.UpdatedAt, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                       L.Name AS LocationName, L.QRCode
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.EmployeeId = @empId
                ORDER BY T.Date DESC, T.CreatedAt DESC
            `;
        }

        const result = await request.query(query);
        res.json({ success: true, timesheets: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/pending', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request().query(`
            SELECT T.Id, T.EmployeeId, T.LocationId, T.Date, T.CheckInTime, T.CheckOutTime,
                   T.RegularHours, T.OvertimeHours, T.Status, T.Notes,
                   T.CreatedAt, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                   L.Name AS LocationName, L.QRCode
            FROM Timesheets T
            INNER JOIN Employees E ON T.EmployeeId = E.Id
            LEFT JOIN WorkLocations L ON T.LocationId = L.Id
            WHERE T.Status = 'pending'
            ORDER BY T.Date DESC, T.CreatedAt DESC
        `);
        res.json({ success: true, timesheets: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/employee/:employeeId', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('employeeId', sql.Int, req.params.employeeId)
            .query(`
                SELECT T.Id, T.EmployeeId, T.LocationId, T.Date, T.CheckInTime, T.CheckOutTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes,
                       T.CreatedAt, L.Name AS LocationName, L.QRCode
                FROM Timesheets T
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.EmployeeId = @employeeId
                ORDER BY T.Date DESC, T.CheckInTime DESC
            `);
        res.json({ success: true, timesheets: result.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT T.*, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                       L.Name AS LocationName, L.QRCode
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.Id = @id
            `);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: result.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST - create timesheet (employeeId comes from JWT token)
router.post('/timesheets', authenticateToken, async (req, res) => {
    try {
        // Accept both startTime/finishTime (frontend) and checkInTime/checkOutTime (legacy)
        const {
            date,
            startTime, finishTime,       // frontend field names
            checkInTime, checkOutTime,   // legacy field names
            regularHours, overtimeHours,
            notes,
            locationId,
            checkInLat, checkInLng,
            checkOutLat, checkOutLng,
            // Admin manual entry
            employeeId: bodyEmployeeId,
            status: bodyStatus
        } = req.body;

        // Use token's employeeId unless admin is submitting for someone else
        const employeeId = (req.user.isAdmin && bodyEmployeeId) ? bodyEmployeeId : req.user.id;
        const resolvedCheckIn = startTime || checkInTime;
        const resolvedCheckOut = finishTime || checkOutTime || null;

        if (!date || !resolvedCheckIn)
            return res.status(400).json({ success: false, error: 'Missing required fields: date, startTime' });

        const finalStatus = bodyStatus || 'pending';

        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('date', sql.Date, date)
            .input('checkInTime', sql.VarChar(10), resolvedCheckIn)
            .input('checkOutTime', sql.VarChar(10), resolvedCheckOut)
            .input('regularHours', sql.Decimal(5, 2), regularHours || 0)
            .input('overtimeHours', sql.Decimal(5, 2), overtimeHours || 0)
            .input('notes', sql.NVarChar(500), notes || '')
            .input('status', sql.VarChar(20), finalStatus);

        // Handle locationId separately - some DBs have NOT NULL constraint
        let insertQuery;
        if (locationId) {
            request.input('locationId', sql.Int, locationId);
            insertQuery = `INSERT INTO Timesheets (EmployeeId, LocationId, Date, CheckInTime, CheckOutTime, RegularHours, OvertimeHours, Notes, Status)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @locationId, @date, @checkInTime, @checkOutTime, @regularHours, @overtimeHours, @notes, @status)`;
        } else {
            insertQuery = `INSERT INTO Timesheets (EmployeeId, Date, CheckInTime, CheckOutTime, RegularHours, OvertimeHours, Notes, Status)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @date, @checkInTime, @checkOutTime, @regularHours, @overtimeHours, @notes, @status)`;
        }

        const result = await request.query(insertQuery);

        res.status(201).json({ success: true, timesheet: result.recordset[0], message: 'Timesheet created successfully' });
    } catch (error) {
        console.error('Timesheet POST error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const { status, notes, approvedBy, checkOutTime, regularHours, overtimeHours } = req.body;
        const pool = await req.app.locals.getPool();
        let updateFields = [];
        let request = pool.request().input('id', sql.Int, req.params.id);
        if (status) {
            updateFields.push('Status = @status');
            request.input('status', sql.VarChar(20), status);
            if (status === 'approved') {
                const approverId = approvedBy || req.user.id;
                updateFields.push('ApprovedBy = @approvedBy');
                updateFields.push('ApprovedAt = GETDATE()');
                request.input('approvedBy', sql.Int, approverId);
            }
        }
        if (notes !== undefined) { updateFields.push('Notes = @notes'); request.input('notes', sql.NVarChar(500), notes); }
        if (checkOutTime) { updateFields.push('CheckOutTime = @checkOutTime'); request.input('checkOutTime', sql.VarChar(10), checkOutTime); }
        if (regularHours !== undefined) { updateFields.push('RegularHours = @regularHours'); request.input('regularHours', sql.Decimal(5, 2), regularHours); }
        if (overtimeHours !== undefined) { updateFields.push('OvertimeHours = @overtimeHours'); request.input('overtimeHours', sql.Decimal(5, 2), overtimeHours); }
        updateFields.push('UpdatedAt = GETDATE()');
        const result = await request.query(`UPDATE Timesheets SET ${updateFields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: result.recordset[0], message: 'Timesheet updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM Timesheets OUTPUT DELETED.* WHERE Id = @id');
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, message: 'Timesheet deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets/:id/approve', authenticateToken, async (req, res) => {
    try {
        const approverId = req.user.id;
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('approvedBy', sql.Int, approverId)
            .query(`UPDATE Timesheets SET Status = 'approved', ApprovedBy = @approvedBy, ApprovedAt = GETDATE(), UpdatedAt = GETDATE() OUTPUT INSERTED.* WHERE Id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: result.recordset[0], message: 'Timesheet approved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets/:id/reject', authenticateToken, async (req, res) => {
    try {
        const { notes } = req.body;
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('notes', sql.NVarChar(500), notes || 'Rejected')
            .query(`UPDATE Timesheets SET Status = 'rejected', Notes = @notes, UpdatedAt = GETDATE() OUTPUT INSERTED.* WHERE Id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: result.recordset[0], message: 'Timesheet rejected successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;