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

router.get('/timesheets', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const request = pool.request();
        let query;
        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT T.Id, T.EmployeeId, T.LocationId, T.CheckInLocation, T.CheckOutLocation, T.BreakMinutes, T.Date, T.StartTime, T.FinishTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.CreatedAt, T.UpdatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode, L.Name AS LocationName
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                ORDER BY T.Date DESC, T.CreatedAt DESC`;
        } else {
            request.input('empId', sql.Int, req.user.id);
            query = `
                SELECT T.Id, T.EmployeeId, T.LocationId, T.CheckInLocation, T.CheckOutLocation, T.BreakMinutes, T.Date, T.StartTime, T.FinishTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.CreatedAt, T.UpdatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode, L.Name AS LocationName
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.EmployeeId = @empId
                ORDER BY T.Date DESC, T.CreatedAt DESC`;
        }
        const rows = await request.query(query);
        res.json({ success: true, timesheets: rows.recordset });
    } catch (error) {
        console.error('GET timesheets error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/pending', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rows = await pool.request().query(`
            SELECT T.Id, T.EmployeeId, T.LocationId, T.CheckInLocation, T.CheckOutLocation, T.BreakMinutes, T.Date, T.StartTime, T.FinishTime,
                   T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.CreatedAt,
                   E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode, L.Name AS LocationName
            FROM Timesheets T
            INNER JOIN Employees E ON T.EmployeeId = E.Id
            LEFT JOIN WorkLocations L ON T.LocationId = L.Id
            WHERE T.Status = 'pending'
            ORDER BY T.Date DESC, T.CreatedAt DESC`);
        res.json({ success: true, timesheets: rows.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/employee/:employeeId', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rows = await pool.request()
            .input('employeeId', sql.Int, req.params.employeeId)
            .query(`
                SELECT T.Id, T.EmployeeId, T.LocationId, T.CheckInLocation, T.CheckOutLocation, T.BreakMinutes, T.Date, T.StartTime, T.FinishTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.CreatedAt, L.Name AS LocationName
                FROM Timesheets T
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.EmployeeId = @employeeId
                ORDER BY T.Date DESC, T.StartTime DESC`);
        res.json({ success: true, timesheets: rows.recordset });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rows = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT T.Id, T.EmployeeId, T.LocationId, T.CheckInLocation, T.CheckOutLocation, T.BreakMinutes, T.Date, T.StartTime, T.FinishTime,
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.CreatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode, L.Name AS LocationName
                FROM Timesheets T
                INNER JOIN Employees E ON T.EmployeeId = E.Id
                LEFT JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.Id = @id`);
        if (rows.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: rows.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets', authenticateToken, async (req, res) => {
    try {
        const { date, startTime, finishTime, StartTime, FinishTime,
                regularHours, overtimeHours, notes, locationId,
                checkInLocation, checkOutLocation, breakMinutes,
                employeeId: bodyEmployeeId, status: bodyStatus } = req.body;

        const employeeId = (req.user.isAdmin == 1 || req.user.isAdmin == true) && bodyEmployeeId
            ? bodyEmployeeId : req.user.id;
        const resolvedCheckIn = startTime || StartTime || null;
        const resolvedCheckOut = finishTime || FinishTime || null;

        if (!date || !resolvedCheckIn)
            return res.status(400).json({ success: false, error: 'Missing required fields: date, startTime' });

        // Prevent duplicate submissions — but allow if existing is just a checkedin stub
        const pool = await req.app.locals.getPool();
        const dupCheck = await pool.request()
            .input('dupEmployeeId', sql.Int, employeeId)
            .input('dupDate', sql.Date, date)
            .query("SELECT Id, Status FROM Timesheets WHERE EmployeeId = @dupEmployeeId AND Date = @dupDate");
        if (dupCheck.recordset.length > 0) {
            const existing = dupCheck.recordset[0];
            // Rejected timesheets — allow fresh check-in by deleting the old record
            if (existing.Status === 'rejected' && bodyStatus === 'checkedin') {
                await pool.request()
                    .input('delId', sql.Int, existing.Id)
                    .query('DELETE FROM Timesheets WHERE Id = @delId');
                // Fall through to insert a fresh record below
            }
            // Non-checkedin, non-rejected record already exists — hard block
            else if (existing.Status !== 'checkedin') {
                return res.status(409).json({ success: false, error: 'A timesheet for this date has already been submitted. Please contact your administrator if you need to make changes.' });
            }
            // checkedin stub exists + full submission arriving — update in place
            else if (existing.Status === 'checkedin' && bodyStatus !== 'checkedin') {
                const updateReq = pool.request()
                    .input('id', sql.Int, existing.Id)
                    .input('FinishTime', sql.VarChar(10), resolvedCheckOut)
                    .input('regularHours', sql.Decimal(5, 2), regularHours || 0)
                    .input('overtimeHours', sql.Decimal(5, 2), overtimeHours || 0)
                    .input('notes', sql.NVarChar(500), notes || '')
                    .input('status', sql.VarChar(20), bodyStatus || 'pending')
                    .input('checkOutLocation', sql.NVarChar(200), checkOutLocation || null)
                    .input('breakMinutes', sql.Int, parseInt(breakMinutes) || 0);
                const updated = await updateReq.query(`
                    UPDATE Timesheets
                    SET FinishTime = @FinishTime,
                        RegularHours = @regularHours,
                        OvertimeHours = @overtimeHours,
                        Notes = @notes,
                        Status = @status,
                        CheckOutLocation = @checkOutLocation,
                        BreakMinutes = @breakMinutes,
                        UpdatedAt = GETDATE()
                    OUTPUT INSERTED.*
                    WHERE Id = @id`);
                return res.status(200).json({ success: true, timesheet: updated.recordset[0], message: 'Timesheet updated from check-in record' });
            }
            // checkedin + another checkedin attempt — block duplicate
            else {
                return res.status(409).json({ success: false, error: 'duplicate_checkedin', existingId: existing.Id });
            }
        }
        const request = pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('date', sql.Date, date)
            .input('StartTime', sql.VarChar(10), resolvedCheckIn)
            .input('FinishTime', sql.VarChar(10), resolvedCheckOut)
            .input('regularHours', sql.Decimal(5, 2), regularHours || 0)
            .input('overtimeHours', sql.Decimal(5, 2), overtimeHours || 0)
            .input('notes', sql.NVarChar(500), notes || '')
            .input('status', sql.VarChar(20), bodyStatus || 'pending')
            .input('checkInLocation', sql.NVarChar(200), checkInLocation || null)
            .input('checkOutLocation', sql.NVarChar(200), checkOutLocation || null)
            .input('breakMinutes', sql.Int, parseInt(breakMinutes) || 0);

        let insertQuery;
        if (locationId) {
            request.input('locationId', sql.Int, locationId);
            insertQuery = `INSERT INTO Timesheets (EmployeeId, LocationId, Date, StartTime, FinishTime, RegularHours, OvertimeHours, Notes, Status, CheckInLocation, CheckOutLocation, BreakMinutes)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @locationId, @date, @StartTime, @FinishTime, @regularHours, @overtimeHours, @notes, @status, @checkInLocation, @checkOutLocation, @breakMinutes)`;
        } else {
            insertQuery = `INSERT INTO Timesheets (EmployeeId, Date, StartTime, FinishTime, RegularHours, OvertimeHours, Notes, Status, CheckInLocation, CheckOutLocation, BreakMinutes)
                           OUTPUT INSERTED.*
                           VALUES (@employeeId, @date, @StartTime, @FinishTime, @regularHours, @overtimeHours, @notes, @status, @checkInLocation, @checkOutLocation, @breakMinutes)`;
        }

        const inserted = await request.query(insertQuery);
        res.status(201).json({ success: true, timesheet: inserted.recordset[0], message: 'Timesheet created successfully' });
    } catch (error) {
        console.error('POST timesheet error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const { status, notes, approvedBy, FinishTime, finishTime, checkOutLocation, regularHours, overtimeHours } = req.body;
        const pool = await req.app.locals.getPool();
        const request = pool.request().input('id', sql.Int, req.params.id);
        const fields = [];
        if (status) {
            fields.push('Status = @status');
            request.input('status', sql.VarChar(20), status);
        }
        if (notes !== undefined) { fields.push('Notes = @notes'); request.input('notes', sql.NVarChar(500), notes); }
        const resolvedFinish = FinishTime || finishTime;
        if (resolvedFinish) { fields.push('FinishTime = @FinishTime'); request.input('FinishTime', sql.VarChar(10), resolvedFinish); }
        if (checkOutLocation) { fields.push('CheckOutLocation = @checkOutLocation'); request.input('checkOutLocation', sql.NVarChar(200), checkOutLocation); }
        if (regularHours !== undefined) { fields.push('RegularHours = @regularHours'); request.input('regularHours', sql.Decimal(5, 2), regularHours); }
        if (overtimeHours !== undefined) { fields.push('OvertimeHours = @overtimeHours'); request.input('overtimeHours', sql.Decimal(5, 2), overtimeHours); }
        if (req.body.breakMinutes !== undefined) { fields.push('BreakMinutes = @breakMinutes'); request.input('breakMinutes', sql.Int, parseInt(req.body.breakMinutes) || 0); }
        fields.push('UpdatedAt = GETDATE()');
        const updated = await request.query(`UPDATE Timesheets SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`);
        if (updated.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: updated.recordset[0], message: 'Updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/timesheets/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const deleted = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM Timesheets OUTPUT DELETED.* WHERE Id = @id');
        if (deleted.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets/:id/approve', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const approved = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`UPDATE Timesheets SET Status='approved', UpdatedAt=GETDATE() OUTPUT INSERTED.* WHERE Id=@id`);
        if (approved.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        const ts = approved.recordset[0];
        // Clean up any orphaned checkedin stub for the same employee+date.
        // These are left behind when checkout creates a new pending row instead of
        // updating the checkedin one in place (race condition / manual admin entry).
        await pool.request()
            .input('cleanEmpId', sql.Int, ts.EmployeeId)
            .input('cleanDate', sql.Date, ts.Date)
            .input('cleanId', sql.Int, ts.Id)
            .query(`DELETE FROM Timesheets WHERE EmployeeId=@cleanEmpId AND Date=@cleanDate AND Status='checkedin' AND Id!=@cleanId`);
        res.json({ success: true, timesheet: ts, message: 'Approved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets/:id/reject', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rejected = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('notes', sql.NVarChar(500), req.body.notes || 'Rejected')
            .query(`UPDATE Timesheets SET Status='rejected', Notes=@notes, UpdatedAt=GETDATE() OUTPUT INSERTED.* WHERE Id=@id`);
        if (rejected.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: rejected.recordset[0], message: 'Rejected' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;