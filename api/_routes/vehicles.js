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

// GET all vehicles (admin) or assigned vehicle (employee)
router.get('/vehicles', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        let query;
        const request = pool.request();

        if (req.user.isAdmin == true || req.user.isAdmin == 1) {
            query = `
                SELECT V.Id, V.PlateNumber, V.Mark, V.Model, V.Mileage,
                       V.MOTExpiry, V.RoadTaxExpiry, V.InsuranceExpiry,
                       V.AssignedDriverId, V.LastServiceDate, V.NextServiceDate,
                       V.Notes, V.IsActive, V.CreatedAt, V.UpdatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS DriverCode
                FROM Vehicles V
                LEFT JOIN Employees E ON V.AssignedDriverId = E.Id
                WHERE V.IsActive = 1
                ORDER BY V.PlateNumber ASC`;
        } else {
            request.input('driverId', sql.Int, req.user.id);
            query = `
                SELECT V.Id, V.PlateNumber, V.Mark, V.Model, V.Mileage,
                       V.MOTExpiry, V.RoadTaxExpiry, V.InsuranceExpiry,
                       V.AssignedDriverId, V.LastServiceDate, V.NextServiceDate,
                       V.Notes, V.IsActive, V.CreatedAt, V.UpdatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS DriverCode
                FROM Vehicles V
                LEFT JOIN Employees E ON V.AssignedDriverId = E.Id
                WHERE V.AssignedDriverId = @driverId AND V.IsActive = 1
                ORDER BY V.PlateNumber ASC`;
        }

        const rows = await request.query(query);
        res.json({ success: true, vehicles: rows.recordset });
    } catch (error) {
        console.error('GET vehicles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET single vehicle
router.get('/vehicles/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const rows = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT V.Id, V.PlateNumber, V.Mark, V.Model, V.Mileage,
                       V.MOTExpiry, V.RoadTaxExpiry, V.InsuranceExpiry,
                       V.AssignedDriverId, V.LastServiceDate, V.NextServiceDate,
                       V.Notes, V.IsActive, V.CreatedAt, V.UpdatedAt,
                       E.FirstName, E.LastName, E.EmployeeId AS DriverCode
                FROM Vehicles V
                LEFT JOIN Employees E ON V.AssignedDriverId = E.Id
                WHERE V.Id = @id`);
        if (rows.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Vehicle not found' });
        res.json({ success: true, vehicle: rows.recordset[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create vehicle (admin only)
router.post('/vehicles', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin)
            return res.status(403).json({ success: false, error: 'Admin access required' });

        const { plateNumber, mark, model, mileage, motExpiry, roadTaxExpiry,
                insuranceExpiry, assignedDriverId, lastServiceDate, nextServiceDate, notes } = req.body;

        if (!plateNumber)
            return res.status(400).json({ success: false, error: 'Plate number is required' });

        const pool = await req.app.locals.getPool();
        const inserted = await pool.request()
            .input('plateNumber', sql.NVarChar(20), plateNumber.toUpperCase().trim())
            .input('mark', sql.NVarChar(50), mark || '')
            .input('model', sql.NVarChar(50), model || '')
            .input('mileage', sql.Int, mileage || 0)
            .input('motExpiry', sql.Date, motExpiry || null)
            .input('roadTaxExpiry', sql.Date, roadTaxExpiry || null)
            .input('insuranceExpiry', sql.Date, insuranceExpiry || null)
            .input('assignedDriverId', sql.Int, assignedDriverId || null)
            .input('lastServiceDate', sql.Date, lastServiceDate || null)
            .input('nextServiceDate', sql.Date, nextServiceDate || null)
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`
                INSERT INTO Vehicles (PlateNumber, Mark, Model, Mileage, MOTExpiry, RoadTaxExpiry,
                    InsuranceExpiry, AssignedDriverId, LastServiceDate, NextServiceDate, Notes, IsActive)
                OUTPUT INSERTED.*
                VALUES (@plateNumber, @mark, @model, @mileage, @motExpiry, @roadTaxExpiry,
                    @insuranceExpiry, @assignedDriverId, @lastServiceDate, @nextServiceDate, @notes, 1)`);

        res.status(201).json({ success: true, vehicle: inserted.recordset[0], message: 'Vehicle added successfully' });
    } catch (error) {
        console.error('POST vehicle error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT update vehicle (admin only)
router.put('/vehicles/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin)
            return res.status(403).json({ success: false, error: 'Admin access required' });

        const { plateNumber, mark, model, mileage, motExpiry, roadTaxExpiry,
                insuranceExpiry, assignedDriverId, lastServiceDate, nextServiceDate, notes } = req.body;

        const pool = await req.app.locals.getPool();
        const updated = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('plateNumber', sql.NVarChar(20), plateNumber ? plateNumber.toUpperCase().trim() : null)
            .input('mark', sql.NVarChar(50), mark || '')
            .input('model', sql.NVarChar(50), model || '')
            .input('mileage', sql.Int, mileage || 0)
            .input('motExpiry', sql.Date, motExpiry || null)
            .input('roadTaxExpiry', sql.Date, roadTaxExpiry || null)
            .input('insuranceExpiry', sql.Date, insuranceExpiry || null)
            .input('assignedDriverId', sql.Int, assignedDriverId || null)
            .input('lastServiceDate', sql.Date, lastServiceDate || null)
            .input('nextServiceDate', sql.Date, nextServiceDate || null)
            .input('notes', sql.NVarChar(500), notes || '')
            .query(`
                UPDATE Vehicles SET
                    PlateNumber = COALESCE(@plateNumber, PlateNumber),
                    Mark = @mark, Model = @model, Mileage = @mileage,
                    MOTExpiry = @motExpiry, RoadTaxExpiry = @roadTaxExpiry,
                    InsuranceExpiry = @insuranceExpiry, AssignedDriverId = @assignedDriverId,
                    LastServiceDate = @lastServiceDate, NextServiceDate = @nextServiceDate,
                    Notes = @notes, UpdatedAt = GETDATE()
                OUTPUT INSERTED.*
                WHERE Id = @id`);

        if (updated.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Vehicle not found' });

        res.json({ success: true, vehicle: updated.recordset[0], message: 'Vehicle updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE vehicle (admin only)
router.delete('/vehicles/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin)
            return res.status(403).json({ success: false, error: 'Admin access required' });

        const pool = await req.app.locals.getPool();
        // Soft delete
        const deleted = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`UPDATE Vehicles SET IsActive = 0, UpdatedAt = GETDATE() OUTPUT INSERTED.* WHERE Id = @id`);

        if (deleted.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Vehicle not found' });

        res.json({ success: true, message: 'Vehicle removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;