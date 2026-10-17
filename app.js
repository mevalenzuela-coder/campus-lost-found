
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const db = require('./config/db');
const bcrypt = require('bcrypt');

const app = express();

app.use(express.static('public'));

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax'
    }
}));

app.get('/', (req, res) => {
    db.query('SELECT COUNT(*) AS total FROM items', (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Database query failed.');
        }

        res.send(`
            <h1>Campus Lost and Found System</h1>
            <p>Welcome to our system!</p>
            <p>Total item reports: ${results[0].total}</p>
        `);
    });
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }

    res.render('login', { error: '' });
});

app.post('/login', (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
        return res.status(400).render('login', {
            error: 'Please enter your email and password.'
        });
    }

    db.query(
        'SELECT id, name, email, password, role FROM users WHERE email = ?',
        [email],
        async (err, results) => {
            if (err) {
                console.error(err.message);
                return res.status(500).render('login', {
                    error: 'Something went wrong. Please try again.'
                });
            }

            if (results.length === 0) {
                return res.status(401).render('login', {
                    error: 'Invalid email or password.'
                });
            }

            const user = results[0];

            try {
                const passwordMatches = await bcrypt.compare(
                    password,
                    user.password
                );

                if (!passwordMatches) {
                    return res.status(401).render('login', {
                        error: 'Invalid email or password.'
                    });
                }

                req.session.regenerate((sessionErr) => {
                    if (sessionErr) {
                        console.error(sessionErr.message);
                        return res.status(500).render('login', {
                            error: 'Could not start your session.'
                        });
                    }

                    req.session.user = {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role
                    };

                    res.redirect('/dashboard');
                });
            } catch (compareErr) {
                console.error(compareErr.message);
                return res.status(500).render('login', {
                    error: 'Login failed. Please try again.'
                });
            }
        }
    );
});

// Protect the dashboard: login is required.
function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (req.session.user.role !== 'admin') {
        return res.status(403).send('Access denied. Admins only.');
    }

    next();
}

app.get('/admin', requireAdmin, (req, res) => {
    const sql = `
        SELECT items.*, users.name AS reporter_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE items.status = 'Pending'
        ORDER BY items.id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load pending reports.');
        }

        res.render('admin', {
            user: req.session.user,
            items: results
        });
    });
});

app.post('/admin/approve/:id', requireAdmin, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid report ID.');
    }

    db.query(
        `UPDATE items SET status = 'Approved'
         WHERE id = ? AND status = 'Pending'`,
        [itemId],
        (err, result) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Could not approve the report.');
            }

            if (result.affectedRows === 0) {
                return res.status(404).send(
                    'Pending report not found or already reviewed.'
                );
            }

            res.redirect('/admin');
        }
    );
});

app.get('/dashboard', requireLogin, (req, res) => {
    db.query('SELECT COUNT(*) AS total FROM items', (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load dashboard.');
        }

        res.render('dashboard', {
            user: req.session.user,
            totalItems: results[0].total
        });
    });
});

app.post('/logout', requireLogin, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not log out.');
        }

        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

app.get('/report', requireLogin, (req, res) => {
    res.render('report', { error: '' });
});

app.post('/report', requireLogin, (req, res) => {
    const itemName = (req.body.item_name || '').trim();
    const description = (req.body.description || '').trim();
    const category = (req.body.category || '').trim();
    const location = (req.body.location || '').trim();
    const date = req.body.date_lost_or_found || '';
    const reportType = req.body.report_type || '';

    const allowedCategories = [
        'Electronics',
        'Documents',
        'Clothing',
        'Accessories',
        'School Supplies',
        'Others'
    ];

    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
        && !Number.isNaN(Date.parse(date))
        && new Date(date).toISOString().slice(0, 10) === date;

    if (
        !itemName || itemName.length > 150 ||
        !description || !category ||
        !allowedCategories.includes(category) ||
        !location || location.length > 150 ||
        !validDate ||
        !['Lost', 'Found'].includes(reportType)
    ) {
        return res.status(400).render('report', {
            error: 'Please complete all fields with valid information.'
        });
    }

    const sql = `
        INSERT INTO items
        (user_id, item_name, description, category, location,
         date_lost_or_found, report_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        req.session.user.id,
        itemName,
        description,
        category,
        location,
        date,
        reportType
    ], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).render('report', {
                error: 'Could not save the report. Please try again.'
            });
        }

        res.redirect('/items');
    });
});


app.get('/items', requireLogin, (req, res) => {
    const q = (req.query.q || '').trim();
    const type = req.query.type || '';
    const status = req.query.status || '';

    let sql = `
        SELECT items.*, users.name AS reporter_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE 1 = 1
    `;

    const params = [];

    if (q) {
        sql += `
            AND (
                items.item_name LIKE ?
                OR items.description LIKE ?
                OR items.category LIKE ?
                OR items.location LIKE ?
            )
        `;

        const searchTerm = `%${q}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (['Lost', 'Found'].includes(type)) {
        sql += ' AND items.report_type = ?';
        params.push(type);
    }

    if (['Pending', 'Approved', 'Claimed', 'Returned'].includes(status)) {
        sql += ' AND items.status = ?';
        params.push(status);
    }

    sql += ' ORDER BY items.id DESC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load item reports.');
        }

        res.render('items', {
            items: results,
            user: req.session.user,
            search: q,
            selectedType: type,
            selectedStatus: status
        });
    });
});

const PORT = process.env.PORT || 3000;

app.get('/register', (req, res) => {
    res.render('register', { error: '' });
});

app.post('/register', async (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!name || name.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 150 ||
        password.length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72) {
        return res.status(400).render('register', {
            error: 'Check your name, email, and password. Password must be 8 or more characters.'
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword],
            (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(409).render('register', {
                            error: 'This email is already registered.'
                        });
                    }

                    console.error(err.message);
                    return res.status(500).render('register', {
                        error: 'Registration failed. Please try again.'
                    });
                }

                return res.redirect('/login');
            }
        );
    } catch (err) {
        console.error(err.message);
        return res.status(500).render('register', {
            error: 'Something went wrong. Please try again.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
