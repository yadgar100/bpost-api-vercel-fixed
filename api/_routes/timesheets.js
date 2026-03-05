const express = require('express');
const router = express.Router();
const sql = require('mssql');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token)
        return res.status(401).json({ success: false, error: 'Access token required' });
    next();
};

router.get('/timesheets', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request().query(`
            SELECT T.Id, T.EmployeeId, T.LocationId, T.Date, T.CheckInTime, T.CheckOutTime,
                   T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.GPSCheckIn, T.GPSCheckOut,
                   T.CreatedAt, T.UpdatedAt, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                   L.Name AS LocationName, L.QRCode,
                   CASE WHEN T.ApprovedBy IS NOT NULL THEN A.FirstName + ' ' + A.LastName ELSE NULL END AS ApprovedByName
            FROM Timesheets T
            INNER JOIN Employees E ON T.EmployeeId = E.Id
            INNER JOIN WorkLocations L ON T.LocationId = L.Id
            LEFT JOIN Employees A ON T.ApprovedBy = A.Id
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
                       T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.GPSCheckIn, T.GPSCheckOut,
                       T.CreatedAt, L.Name AS LocationName, L.QRCode
                FROM Timesheets T
                INNER JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.EmployeeId = @employeeId
                ORDER BY T.Date DESC, T.CheckInTime DESC
            `);
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
                   T.RegularHours, T.OvertimeHours, T.Status, T.Notes, T.GPSCheckIn, T.GPSCheckOut,
                   T.CreatedAt, E.FirstName, E.LastName, E.EmployeeId AS EmployeeCode,
                   L.Name AS LocationName, L.QRCode
            FROM Timesheets T
            INNER JOIN Employees E ON T.EmployeeId = E.Id
            INNER JOIN WorkLocations L ON T.LocationId = L.Id
            WHERE T.Status = 'pending'
            ORDER BY T.Date DESC, T.CreatedAt DESC
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
                INNER JOIN WorkLocations L ON T.LocationId = L.Id
                WHERE T.Id = @id
            `);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Timesheet not found' });
        res.json({ success: true, timesheet: result.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/timesheets', authenticateToken, async (req, res) => {
    try {
        const { employeeId, locationId, date, checkInTime, checkOutTime, regularHours, overtimeHours, notes, gpsCheckIn, gpsCheckOut } = req.body;
        if (!employeeId || !locationId || !date || !checkInTime)
            return res.status(400).json({ success: false, error: 'Missing required fields: employeeId, locationId, date, checkInTime' });
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .input('locationId', sql.Int, locationId)
            .input('date', sql.Date, date)
            .input('checkInTime', sql.Time, checkInTime)
            .input('checkOutTime', sql.Time, checkOutTime || null)
            .input('regularHours', sql.Decimal(5,2), regularHours || 0)
            .input('overtimeHours', sql.Decimal(5,2), overtimeHours || 0)
            .input('notes', sql.NVarChar(500), notes || '')
            .input('gpsCheckIn', sql.NVarChar(100), gpsCheckIn || '')
            .input('gpsCheckOut', sql.NVarChar(100), gpsCheckOut || '')
            .query(`INSERT INTO Timesheets (EmployeeId, LocationId, Date, CheckInTime, CheckOutTime, RegularHours, OvertimeHours, Notes, GPSCheckIn, GPSCheckOut, Status)
                    OUTPUT INSERTED.* VALUES (@employeeId, @locationId, @date, @checkInTime, @checkOutTime, @regularHours, @overtimeHours, @notes, @gpsCheckIn, @gpsCheckOut, 'pending')`);
        res.status(201).json({ success: true, timesheet: result.recordset[0], message: 'Timesheet created successfully' });
    } catch (error) {
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
            if (status === 'approved' && approvedBy) {
                updateFields.push('ApprovedBy = @approvedBy');
                updateFields.push('ApprovedAt = GETDATE()');
                request.input('approvedBy', sql.Int, approvedBy);
            }
        }
        if (notes !== undefined) { updateFields.push('Notes = @notes'); request.input('notes', sql.NVarChar(500), notes); }
        if (checkOutTime) { updateFields.push('CheckOutTime = @checkOutTime'); request.input('checkOutTime', sql.Time, checkOutTime); }
        if (regularHours !== undefined) { updateFields.push('RegularHours = @regularHours'); request.input('regularHours', sql.Decimal(5,2), regularHours); }
        if (overtimeHours !== undefined) { updateFields.push('OvertimeHours = @overtimeHours'); request.input('overtimeHours', sql.Decimal(5,2), overtimeHours); }
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
        const { approvedBy } = req.body;
        if (!approvedBy)
            return res.status(400).json({ success: false, error: 'approvedBy field is required' });
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('approvedBy', sql.Int, approvedBy)
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