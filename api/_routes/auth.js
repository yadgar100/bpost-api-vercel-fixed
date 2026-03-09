const bcrypt = require('bcryptjs');
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
            .query(`SELECT Id, EmployeeId, FirstName, LastName, Email, PasswordHash,
                           Department, Position, HourlyRate, IsAdmin, AssignedLocations, AdminPermissions, IsActive,
                           Country, Currency
                    FROM Employees WHERE LOWER(Email) = @email`);

        if (result.recordset.length === 0)
            return res.status(401).json({ success: false, error: 'Invalid email or password' });

        const user = result.recordset[0];

        if (!user.IsActive)
            return res.status(401).json({ success: false, error: 'Account is inactive. Please contact administrator.' });

        const isValidPassword = await bcrypt.compare(password, user.PasswordHash);
        if (!isValidPassword)
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
                assignedLocations: user.AssignedLocations ? JSON.parse(user.AssignedLocations) : [],
                adminPermissions: user.AdminPermissions ? JSON.parse(user.AdminPermissions) : {},
                country: user.Country || '',
                currency: user.Currency || 'GBP'
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

        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, decoded.id)
            .query(`SELECT Id, EmployeeId, FirstName, LastName, Email,
                           Department, Position, HourlyRate, IsAdmin, AssignedLocations, AdminPermissions, IsActive,
                           Country, Currency
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
                assignedLocations: user.AssignedLocations ? JSON.parse(user.AssignedLocations) : [],
                adminPermissions: user.AdminPermissions ? JSON.parse(user.AdminPermissions) : {},
                country: user.Country || '',
                currency: user.Currency || 'GBP'
            }
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        console.error('Verify error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


router.post('/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password, department, position } = req.body;
        if (!firstName || !lastName || !email || !password)
            return res.status(400).json({ success: false, error: 'First name, last name, email and password are required' });

        if (password.length < 6)
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

        const pool = await req.app.locals.getPool();

        const checkEmail = await pool.request()
            .input('email', sql.VarChar(100), email.toLowerCase())
            .query('SELECT Id FROM Employees WHERE LOWER(Email) = @email');
        if (checkEmail.recordset.length > 0)
            return res.status(400).json({ success: false, error: 'Email already exists' });

        const countResult = await pool.request().query("SELECT ISNULL(MAX(Id), 0) as maxId FROM Employees");
        const maxId = countResult.recordset[0].maxId;
        const employeeId = `EMP${String(maxId + 1).padStart(3, '0')}`;

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.request()
            .input('employeeId', sql.VarChar(20), employeeId)
            .input('firstName', sql.NVarChar(50), firstName)
            .input('lastName', sql.NVarChar(50), lastName)
            .input('email', sql.VarChar(100), email.toLowerCase())
            .input('passwordHash', sql.NVarChar(100), passwordHash)
            .input('department', sql.NVarChar(50), department || '')
            .input('position', sql.NVarChar(50), position || '')
            .query(`INSERT INTO Employees (EmployeeId, FirstName, LastName, Email, PasswordHash, Department, Position, HourlyRate, IsAdmin, AssignedLocations, IsActive)
                    OUTPUT INSERTED.*
                    VALUES (@employeeId, @firstName, @lastName, @email, @passwordHash, @department, @position, 0, 0, '[]', 1)`);

        const newUser = result.recordset[0];
        const token = jwt.sign(
            { id: newUser.Id, employeeId: newUser.EmployeeId, email: newUser.Email, isAdmin: newUser.IsAdmin },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            token,
            user: {
                id: newUser.Id,
                employeeId: newUser.EmployeeId,
                firstName: newUser.FirstName,
                lastName: newUser.LastName,
                email: newUser.Email,
                department: newUser.Department || '',
                position: newUser.Position || '',
                hourlyRate: newUser.HourlyRate || 0,
                isAdmin: newUser.IsAdmin,
                assignedLocations: [],
                adminPermissions: {},
                country: newUser.Country || '',
                currency: newUser.Currency || 'GBP'
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;