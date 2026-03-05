const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bpost-secret-2024-secure-key';

router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ success: false, error: 'Email and password are required' });

        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('email', sql.VarChar(100), email.toLowerCase())
            .query(`SELECT Id, EmployeeId, FirstName, LastName, Email, Password,
                           Department, Position, HourlyRate, IsAdmin, AssignedLocations, IsActive
                    FROM Employees WHERE LOWER(Email) = @email`);

        if (result.recordset.length === 0)
            return res.status(401).json({ success: false, error: 'Invalid email or password' });

        const user = result.recordset[0];

        if (!user.IsActive)
            return res.status(401).json({ success: false, error: 'Account is inactive. Please contact administrator.' });

        if (user.Password !== password)
            return res.status(401).json({ success: false, error: 'Invalid email or password' });

        const token = jwt.sign(
            { id: user.Id, employeeId: user.EmployeeId, email: user.Email, isAdmin: user.IsAdmin },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.Id,
                employeeId: user.EmployeeId,
                firstName: user.FirstName,
                lastName: user.LastName,
                email: user.Email,
                department: user.Department,
                position: user.Position,
                hourlyRate: user.HourlyRate,
                isAdmin: user.IsAdmin,
                assignedLocations: user.AssignedLocations ? JSON.parse(user.AssignedLocations) : []
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/auth/verify', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token)
            return res.status(401).json({ success: false, error: 'No token provided' });

        const decoded = jwt.verify(token, JWT_SECRET);

        const pool = await req.app.locals.getPool();  // ✅ fixed
        const result = await pool.request()
            .input('id', sql.Int, decoded.id)
            .query(`SELECT Id, EmployeeId, FirstName, LastName, Email,
                           Department, Position, HourlyRate, IsAdmin, AssignedLocations, IsActive
                    FROM Employees WHERE Id = @id`);

        if (result.recordset.length === 0 || !result.recordset[0].IsActive)
            return res.status(401).json({ success: false, error: 'Invalid or inactive user' });

        const user = result.recordset[0];
        res.json({
            success: true,
            user: {
                id: user.Id,
                employeeId: user.EmployeeId,
                firstName: user.FirstName,
                lastName: user.LastName,
                email: user.Email,
                department: user.Department,
                position: user.Position,
                hourlyRate: user.HourlyRate,
                isAdmin: user.IsAdmin,
                assignedLocations: user.AssignedLocations ? JSON.parse(user.AssignedLocations) : []
            }
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        console.error('Verify error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;