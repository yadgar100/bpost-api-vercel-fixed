// ============================================
// Work Locations Routes
// ============================================

const express = require('express');
const router = express.Router();
const sql = require('mssql');

// ============================================
// GET /api/locations - Get all locations
// ============================================
router.get('/locations', async (req, res) => {
    try {
       // ✅ Correct - use app.locals
const pool = await req.app.locals.getPool();
        
        const result = await pool.request().query(`
            SELECT 
                Id,
                Name,
                Address,
                Latitude,
                Longitude,
                QRCode,
                Radius,
                IsActive,
                CreatedAt
            FROM WorkLocations
            ORDER BY Name
        `);

        res.json({
            success: true,
            locations: result.recordset
        });

    } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET /api/locations/:id - Get specific location
// ============================================
router.get('/locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect();
        
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    Id,
                    Name,
                    Address,
                    Latitude,
                    Longitude,
                    QRCode,
                    Radius,
                    IsActive,
                    CreatedAt
                FROM WorkLocations
                WHERE Id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            location: result.recordset[0]
        });

    } catch (error) {
        console.error('Error fetching location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// POST /api/locations - Create new location
// ============================================
router.post('/locations', async (req, res) => {
    try {
        const {
            name,
            address,
            latitude,
            longitude,
            qrCode,
            radius
        } = req.body;

        // Validation
        if (!name || !latitude || !longitude || !qrCode) {
            return res.status(400).json({
                success: false,
                error: 'Name, latitude, longitude, and QR code are required'
            });
        }

        const pool = await sql.connect();

        // Check if QR code already exists
        const checkQR = await pool.request()
            .input('qrCode', sql.VarChar(50), qrCode)
            .query('SELECT Id FROM WorkLocations WHERE QRCode = @qrCode');

        if (checkQR.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'QR code already exists'
            });
        }

        // Insert location
        const result = await pool.request()
            .input('name', sql.NVarChar(100), name)
            .input('address', sql.NVarChar(200), address || '')
            .input('latitude', sql.Decimal(10, 6), latitude)
            .input('longitude', sql.Decimal(10, 6), longitude)
            .input('qrCode', sql.VarChar(50), qrCode)
            .input('radius', sql.Int, radius || 100)
            .query(`
                INSERT INTO WorkLocations 
                (Name, Address, Latitude, Longitude, QRCode, Radius, IsActive)
                OUTPUT INSERTED.*
                VALUES 
                (@name, @address, @latitude, @longitude, @qrCode, @radius, 1)
            `);

        res.status(201).json({
            success: true,
            location: result.recordset[0],
            message: 'Location created successfully'
        });

    } catch (error) {
        console.error('Error creating location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// PUT /api/locations/:id - Update location
// ============================================
router.put('/locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            address,
            latitude,
            longitude,
            radius,
            isActive
        } = req.body;

        const pool = await sql.connect();

        // Build dynamic update query
        let updateFields = [];
        let request = pool.request().input('id', sql.Int, id);

        if (name !== undefined) {
            updateFields.push('Name = @name');
            request.input('name', sql.NVarChar(100), name);
        }
        if (address !== undefined) {
            updateFields.push('Address = @address');
            request.input('address', sql.NVarChar(200), address);
        }
        if (latitude !== undefined) {
            updateFields.push('Latitude = @latitude');
            request.input('latitude', sql.Decimal(10, 6), latitude);
        }
        if (longitude !== undefined) {
            updateFields.push('Longitude = @longitude');
            request.input('longitude', sql.Decimal(10, 6), longitude);
        }
        if (radius !== undefined) {
            updateFields.push('Radius = @radius');
            request.input('radius', sql.Int, radius);
        }
        if (isActive !== undefined) {
            updateFields.push('IsActive = @isActive');
            request.input('isActive', sql.Bit, isActive);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        const result = await request.query(`
            UPDATE WorkLocations
            SET ${updateFields.join(', ')}
            OUTPUT INSERTED.*
            WHERE Id = @id
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            location: result.recordset[0],
            message: 'Location updated successfully'
        });

    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE /api/locations/:id - Delete location
// ============================================
router.delete('/locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect();

        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                DELETE FROM WorkLocations
                OUTPUT DELETED.*
                WHERE Id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            message: 'Location deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
