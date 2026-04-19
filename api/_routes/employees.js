======================================================
BRANCH FEATURE — employees.js CHANGES REQUIRED
======================================================

In your existing api/_routes/employees.js file, make these changes:

──────────────────────────────────────────────────────
1. Add `Branches` to every SELECT query
──────────────────────────────────────────────────────
Find queries that select from Employees (usually GET /employees and GET /employees/:id).
Add `Branches` to the column list, e.g.:

BEFORE:
    SELECT Id, EmployeeId, FirstName, LastName, Email, Department, Position,
           HourlyRate, IsAdmin, AssignedLocations, AdminPermissions,
           Country, Currency, StandardHours, OvertimeRate, MinimumHours
    FROM Employees

AFTER:
    SELECT Id, EmployeeId, FirstName, LastName, Email, Department, Position,
           HourlyRate, IsAdmin, AssignedLocations, AdminPermissions,
           Country, Currency, StandardHours, OvertimeRate, MinimumHours,
           Branches
    FROM Employees

──────────────────────────────────────────────────────
2. Support `branches` in the PUT /employees/:id handler
──────────────────────────────────────────────────────
Find the PUT handler. Where it destructures req.body, add `branches`:

    const { firstName, lastName, email, department, position, hourlyRate,
            country, currency, standardHours, overtimeRate, minimumHours,
            assignedLocations, adminPermissions, branches } = req.body;

Where it builds the UPDATE SQL / sets inputs, add a branch to the logic
(same pattern as AssignedLocations):

    if (branches !== undefined) {
        fields.push('Branches = @branches');
        request.input('branches', sql.NVarChar(500), typeof branches === 'string' ? branches : JSON.stringify(branches || []));
    }

──────────────────────────────────────────────────────
3. (Optional) Support `branches` in POST /employees (admin create)
──────────────────────────────────────────────────────
If you want admins to set branches when creating employees, add the same
destructure + input + column to your INSERT statement.

======================================================
After these edits, push to GitHub and Vercel auto-deploys.
======================================================