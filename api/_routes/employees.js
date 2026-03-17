const express = require('express');
const router = express.Router();
const sql = require('mssql');

router.get('/employees', async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request().query(`
            SELECT Id, EmployeeId, FirstName, LastName, Email,
                   Department, Position, HourlyRate, IsAdmin,
                   AssignedLocations, IsActive, CreatedAt,
                   Country, Currency, StandardHours, OvertimeRate
            FROM Employees ORDER BY FirstName, LastName
        `);
        const employees = result.recordset.map(emp => ({
            ...emp,
            AssignedLocations: emp.AssignedLocations ? JSON.parse(emp.AssignedLocations) : []
        }));
        res.json({ success: true, employees });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/employees/:id', async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`SELECT * FROM Employees WHERE Id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Employee not found' });
        const employee = result.recordset[0];
        employee.AssignedLocations = employee.AssignedLocations ? JSON.parse(employee.AssignedLocations) : [];
        res.json({ success: true, employee });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/employees', async (req, res) => {
    try {
        const { firstName, lastName, email, password, department, position, hourlyRate, isAdmin, assignedLocations } = req.body;
        if (!firstName || !lastName || !email || !password)
            return res.status(400).json({ success: false, error: 'First name, last name, email, and password are required' });
        const pool = await req.app.locals.getPool();
        const checkEmail = await pool.request()
            .input('email', sql.VarChar(100), email.toLowerCase())
            .query('SELECT Id FROM Employees WHERE LOWER(Email) = @email');
        if (checkEmail.recordset.length > 0)
            return res.status(400).json({ success: false, error: 'Email already exists' });
        const countResult = await pool.request().query('SELECT COUNT(*) as count FROM Employees');
        const count = countResult.recordset[0].count;
        const employeeId = isAdmin ? `ADM${String(count + 1).padStart(3, '0')}` : `EMP${String(count + 1).padStart(3, '0')}`;
        const result = await pool.request()
            .input('employeeId', sql.VarChar(20), employeeId)
            .input('firstName', sql.NVarChar(50), firstName)
            .input('lastName', sql.NVarChar(50), lastName)
            .input('email', sql.VarChar(100), email.toLowerCase())
            .input('passwordHash', sql.NVarChar(100), password)
            .input('department', sql.NVarChar(50), department || '')
            .input('position', sql.NVarChar(50), position || '')
            .input('hourlyRate', sql.Decimal(10, 2), hourlyRate || 0)
            .input('isAdmin', sql.Bit, isAdmin || false)
            .input('assignedLocations', sql.NVarChar(sql.MAX), JSON.stringify(assignedLocations || []))
            .query(`INSERT INTO Employees (EmployeeId,FirstName,LastName,Email,PasswordHash,Department,Position,HourlyRate,IsAdmin,AssignedLocations,IsActive)
                    OUTPUT INSERTED.* VALUES (@employeeId,@firstName,@lastName,@email,@passwordHash,@department,@position,@hourlyRate,@isAdmin,@assignedLocations,1)`);
        const newEmployee = result.recordset[0];
        newEmployee.AssignedLocations = JSON.parse(newEmployee.AssignedLocations);
        res.status(201).json({ success: true, employee: newEmployee, message: 'Employee created successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/employees/:id', async (req, res) => {
    try {
        const { firstName, lastName, email, department, position, hourlyRate, assignedLocations, isActive, country, currency, standardHours, overtimeRate } = req.body;
        const pool = await req.app.locals.getPool();
        let updateFields = [];
        let request = pool.request().input('id', sql.Int, req.params.id);
        if (firstName !== undefined) { updateFields.push('FirstName = @firstName'); request.input('firstName', sql.NVarChar(50), firstName); }
        if (lastName !== undefined) { updateFields.push('LastName = @lastName'); request.input('lastName', sql.NVarChar(50), lastName); }
        if (email !== undefined) { updateFields.push('Email = @email'); request.input('email', sql.VarChar(100), email.toLowerCase()); }
        if (department !== undefined) { updateFields.push('Department = @department'); request.input('department', sql.NVarChar(50), department); }
        if (position !== undefined) { updateFields.push('Position = @position'); request.input('position', sql.NVarChar(50), position); }
        if (hourlyRate !== undefined) { updateFields.push('HourlyRate = @hourlyRate'); request.input('hourlyRate', sql.Decimal(10, 2), hourlyRate); }
        if (assignedLocations !== undefined) { updateFields.push('AssignedLocations = @assignedLocations'); request.input('assignedLocations', sql.NVarChar(sql.MAX), JSON.stringify(assignedLocations)); }
        if (isActive !== undefined) { updateFields.push('IsActive = @isActive'); request.input('isActive', sql.Bit, isActive); }
        if (country !== undefined) { updateFields.push('Country = @country'); request.input('country', sql.NVarChar(100), country); }
        if (currency !== undefined) { updateFields.push('Currency = @currency'); request.input('currency', sql.NVarChar(10), currency); }
        if (standardHours !== undefined) { updateFields.push('StandardHours = @standardHours'); request.input('standardHours', sql.Decimal(5,2), standardHours); }
        if (overtimeRate !== undefined) { updateFields.push('OvertimeRate = @overtimeRate'); request.input('overtimeRate', sql.Decimal(5,2), overtimeRate); }
        if (updateFields.length === 0)
            return res.status(400).json({ success: false, error: 'No fields to update' });
        const result = await request.query(`UPDATE Employees SET ${updateFields.join(', ')} OUTPUT INSERTED.* WHERE Id = @id`);
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Employee not found' });
        const employee = result.recordset[0];
        employee.AssignedLocations = employee.AssignedLocations ? JSON.parse(employee.AssignedLocations) : [];
        res.json({ success: true, employee, message: 'Employee updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/employees/:id', async (req, res) => {
    try {
        const pool = await req.app.locals.getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM Employees OUTPUT DELETED.* WHERE Id = @id');
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'Employee not found' });
        res.json({ success: true, message: 'Employee deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;