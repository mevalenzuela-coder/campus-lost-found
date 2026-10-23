
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const db = require('./config/db');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
            ? ext
            : '.jpg';
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed.'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

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
    const statsSql = `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN report_type = 'Lost' THEN 1 ELSE 0 END) AS lost,
            SUM(CASE WHEN report_type = 'Found' THEN 1 ELSE 0 END) AS found
        FROM items
        WHERE status = 'Approved'
    `;

    const recentSql = `
        SELECT items.*, users.name AS reporter_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE items.status = 'Approved'
        ORDER BY items.id DESC
        LIMIT 4
    `;

    db.query(statsSql, (err, statsResults) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load homepage statistics.');
        }

        db.query(recentSql, (err, recentItems) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Could not load recent items.');
            }

            const currentUser = req.session.user || null;

            const renderHome = (myClaimStatuses) => {
                res.render('home', {
                    totalItems: statsResults[0].total || 0,
                    lostItems: statsResults[0].lost || 0,
                    foundItems: statsResults[0].found || 0,
                    recentItems,
                    user: currentUser,
                    myClaimStatuses
                });
            };

            if (!currentUser) {
                return renderHome({});
            }

            db.query(
                `SELECT item_id, status
                 FROM claims
                 WHERE claimant_id = ?
                   AND status IN ('Pending', 'Approved')
                 ORDER BY id DESC`,
                [currentUser.id],
                (claimErr, claimRows) => {
                    if (claimErr) {
                        console.error(claimErr.message);
                        return res.status(500).send('Could not load claim information.');
                    }

                    renderHome(buildClaimStatusMap(claimRows));
                }
            );
        });
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
    const pendingItemsSql = `
        SELECT items.*, users.name AS reporter_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE items.status = 'Pending'
        ORDER BY items.id DESC
    `;

    const pendingClaimsSql = `
        SELECT claims.id, claims.proof, claims.contact,
               DATE_FORMAT(claims.created_at, '%b %d, %Y %h:%i %p') AS submitted_at,
               DATE_FORMAT(items.date_lost_or_found, '%Y-%m-%d') AS item_date,
               items.item_name, items.description, items.location, items.category,
               items.image_path, items.status AS item_status,
               claimant.name AS claimant_name,
               claimant.email AS claimant_email
        FROM claims
        JOIN items ON claims.item_id = items.id
        JOIN users AS claimant ON claims.claimant_id = claimant.id
        WHERE claims.status = 'Pending'
        ORDER BY claims.id ASC
    `;

    const claimedItemsSql = `
        SELECT items.id, items.item_name, items.location, items.category,
               items.image_path,
               DATE_FORMAT(items.date_lost_or_found, '%Y-%m-%d') AS item_date,
               items.status, users.name AS reporter_name,
               (
                   SELECT claimant.name
                   FROM claims
                   JOIN users AS claimant ON claims.claimant_id = claimant.id
                   WHERE claims.item_id = items.id
                     AND claims.status = 'Approved'
                   ORDER BY claims.id DESC
                   LIMIT 1
               ) AS claimant_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE items.status = 'Claimed'
        ORDER BY items.id DESC
    `;

    db.query(pendingItemsSql, (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load pending reports.');
        }

        db.query(pendingClaimsSql, (claimErr, pendingClaims) => {
            if (claimErr) {
                console.error(claimErr.message);
                return res.status(500).send('Could not load pending claims.');
            }

            db.query(claimedItemsSql, (claimedErr, claimedItems) => {
                if (claimedErr) {
                    console.error(claimedErr.message);
                    return res.status(500).send('Could not load claimed items.');
                }

                res.render('admin', {
                    user: req.session.user,
                    items: results,
                    pendingClaims,
                    claimedItems,
                    notice: req.query.notice || ''
                });
            });
        });
    });
});

app.get('/admin/claims', requireAdmin, (req, res) => {
    const sql = `
        SELECT claims.id, claims.item_id, claims.proof, claims.contact,
               claims.status, claims.admin_note,
               DATE_FORMAT(claims.created_at, '%b %d, %Y %h:%i %p') AS submitted_at,
               DATE_FORMAT(claims.reviewed_at, '%b %d, %Y %h:%i %p') AS reviewed_at,
               items.item_name, items.description, items.location, items.category,
               items.image_path, items.status AS item_status,
               DATE_FORMAT(items.date_lost_or_found, '%Y-%m-%d') AS item_date,
               claimant.name AS claimant_name,
               claimant.email AS claimant_email,
               reviewer.name AS reviewer_name
        FROM claims
        JOIN items ON claims.item_id = items.id
        JOIN users AS claimant ON claims.claimant_id = claimant.id
        LEFT JOIN users AS reviewer ON claims.reviewed_by = reviewer.id
        ORDER BY claims.id DESC
    `;

    db.query(sql, (err, claims) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load claim requests.');
        }

        res.render('admin-claims', {
            user: req.session.user,
            claims,
            notice: req.query.notice || ''
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

app.post('/admin/claims/:id/approve', requireAdmin, (req, res) => {
    const claimId = Number(req.params.id);

    if (!Number.isInteger(claimId) || claimId < 1) {
        return res.status(400).send('Invalid claim ID.');
    }

    db.getConnection((connErr, connection) => {
        if (connErr) {
            console.error(connErr.message);
            return res.status(500).send('Could not review the claim.');
        }

        connection.beginTransaction((beginErr) => {
            if (beginErr) {
                console.error(beginErr.message);
                connection.release();
                return res.status(500).send('Could not review the claim.');
            }

            const rollback = (statusCode, message) => {
                connection.rollback(() => {
                    connection.release();
                    res.status(statusCode).send(message);
                });
            };

            const sql = `
            SELECT claims.id, claims.item_id,
                   claims.status AS claim_status,
                   items.status AS item_status,
                   items.report_type AS item_type
            FROM claims
            JOIN items ON claims.item_id = items.id
            WHERE claims.id = ?
            FOR UPDATE
        `;

        connection.query(sql, [claimId], (selectErr, results) => {
            if (selectErr) {
                console.error(selectErr.message);
                return rollback(500, 'Could not review the claim.');
            }

            if (results.length === 0) {
                return rollback(404, 'Claim not found.');
            }

            const claim = results[0];

            if (claim.claim_status !== 'Pending') {
                return rollback(409, 'This claim has already been reviewed.');
            }

            if (claim.item_type !== 'Found') {
                return rollback(409, 'Only found items can be claimed.');
            }

            if (claim.item_status !== 'Approved') {
                return rollback(
                    409,
                    'This item is not approved for claims and cannot be claimed yet.'
                );
            }

            connection.query(
                `UPDATE claims
                 SET status = 'Approved',
                     reviewed_by = ?,
                     reviewed_at = NOW()
                 WHERE id = ?`,
                [req.session.user.id, claimId],
                (approveErr) => {
                    if (approveErr) {
                        console.error(approveErr.message);
                        return rollback(500, 'Could not approve the claim.');
                    }

                    connection.query(
                        `UPDATE items
                         SET status = 'Claimed'
                         WHERE id = ? AND status = 'Approved'`,
                        [claim.item_id],
                        (itemErr, itemResult) => {
                            if (itemErr) {
                                console.error(itemErr.message);
                                return rollback(500, 'Could not update the item.');
                            }

                            if (itemResult.affectedRows === 0) {
                                return rollback(
                                    409,
                                    'This item is no longer available for claim approval.'
                                );
                            }

                            connection.query(
                                `UPDATE claims
                                 SET status = 'Rejected',
                                     admin_note = 'Another claim was approved for this item.',
                                     reviewed_by = ?,
                                     reviewed_at = NOW()
                                 WHERE item_id = ?
                                   AND id <> ?
                                   AND status = 'Pending'`,
                                [req.session.user.id, claim.item_id, claimId],
                                (otherClaimsErr) => {
                                    if (otherClaimsErr) {
                                        console.error(otherClaimsErr.message);
                                        return rollback(
                                            500,
                                            'Could not update the other claims.'
                                        );
                                    }

                                    connection.commit((commitErr) => {
                                        if (commitErr) {
                                            console.error(commitErr.message);
                                            return rollback(
                                                500,
                                                'Could not approve the claim.'
                                            );
                                        }

                                        connection.release();
                                        const returnTo = req.body.return_to === '/admin/claims'
                                            ? '/admin/claims'
                                            : '/admin';
                                        res.redirect(`${returnTo}?notice=claim-approved`);
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});
});

app.post('/admin/claims/:id/reject', requireAdmin, (req, res) => {
    const claimId = Number(req.params.id);
    const adminNote = (req.body.admin_note || '').trim();

    if (!Number.isInteger(claimId) || claimId < 1) {
        return res.status(400).send('Invalid claim ID.');
    }

    if (adminNote.length > 255) {
        return res.status(400).send('The rejection reason is too long.');
    }

    db.query(
        `UPDATE claims
         SET status = 'Rejected',
             admin_note = ?,
             reviewed_by = ?,
             reviewed_at = NOW()
         WHERE id = ? AND status = 'Pending'`,
        [adminNote || null, req.session.user.id, claimId],
        (err, result) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Could not reject the claim.');
            }

            if (result.affectedRows === 0) {
                return res.status(404).send(
                    'Pending claim not found or already reviewed.'
                );
            }

            const returnTo = req.body.return_to === '/admin/claims'
                ? '/admin/claims'
                : '/admin';
            res.redirect(`${returnTo}?notice=claim-rejected`);
        }
    );
});

app.post('/admin/items/:id/return', requireAdmin, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid item ID.');
    }

    db.query(
        `UPDATE items
         SET status = 'Returned'
         WHERE id = ? AND status = 'Claimed'`,
        [itemId],
        (err, result) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Could not update the item.');
            }

            if (result.affectedRows === 0) {
                return res.status(404).send(
                    'Claimed item not found or already returned.'
                );
            }

            const returnTo = req.body.return_to === '/admin/claims'
                ? '/admin/claims'
                : '/admin';
            res.redirect(`${returnTo}?notice=item-returned`);
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

app.post('/report', requireLogin, (req, res, next) => {
    upload.single('item_image')(req, res, (err) => {
        if (err) {
            return res.status(400).render('report', {
                error: 'Please upload a valid image (JPG, PNG, GIF, or WebP, up to 5MB).'
            });
        }

        next();
    });
}, (req, res) => {
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
        if (req.file) {
            const filePath = path.join(uploadsDir, req.file.filename);
            fs.unlink(filePath, () => {});
        }

        return res.status(400).render('report', {
            error: 'Please complete all fields with valid information.'
        });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const sql = `
        INSERT INTO items
        (user_id, item_name, description, category, location,
         date_lost_or_found, report_type, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        req.session.user.id,
        itemName,
        description,
        category,
        location,
        date,
        reportType,
        imagePath
    ], (err) => {
        if (err) {
            console.error(err.message);
            if (req.file) {
                const filePath = path.join(uploadsDir, req.file.filename);
                fs.unlink(filePath, () => {});
            }

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

        db.query(
            `SELECT item_id, status
             FROM claims
             WHERE claimant_id = ?
               AND status IN ('Pending', 'Approved')
             ORDER BY id DESC`,
            [req.session.user.id],
            (claimErr, claimRows) => {
                if (claimErr) {
                    console.error(claimErr.message);
                    return res.status(500).send('Could not load claim information.');
                }

                res.render('items', {
                    items: results,
                    user: req.session.user,
                    search: q,
                    selectedType: type,
                    selectedStatus: status,
                    myClaimStatuses: buildClaimStatusMap(claimRows),
                    claimError: req.query.claim_error || ''
                });
            }
        );
    });
});

app.get('/items/:id/edit', requireLogin, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid item ID.');
    }

    const sql = `
        SELECT *
        FROM items
        WHERE id = ? AND user_id = ? AND status = 'Pending'
    `;

    db.query(sql, [itemId, req.session.user.id], (err, results) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load item for editing.');
        }

        if (results.length === 0) {
            return res.status(404).send(
                'Item not found, not yours, or no longer pending.'
            );
        }

        res.render('edit', {
            item: results[0],
            error: ''
        });
    });
});


app.post('/items/:id/edit', requireLogin, (req, res, next) => {
    upload.single('item_image')(req, res, (err) => {
        if (err) {
            return res.status(400).send(
                'Please upload a valid image (JPG, PNG, GIF, or WebP, up to 5MB).'
            );
        }

        next();
    });
}, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        if (req.file) {
            fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
        }

        return res.status(400).send('Invalid item ID.');
    }

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
        !itemName ||
        itemName.length > 150 ||
        !description ||
        !allowedCategories.includes(category) ||
        !location ||
        location.length > 150 ||
        !validDate ||
        !['Lost', 'Found'].includes(reportType)
    ) {
        if (req.file) {
            fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
        }

        return res.status(400).send('Please enter valid item details.');
    }

    db.query(
        `SELECT image_path
         FROM items
         WHERE id = ? AND user_id = ? AND status = 'Pending'`,
        [itemId, req.session.user.id],
        (findErr, rows) => {
            if (findErr) {
                console.error(findErr.message);
                if (req.file) {
                    fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
                }
                return res.status(500).send('Could not update the item.');
            }

            if (rows.length === 0) {
                if (req.file) {
                    fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
                }
                return res.status(404).send(
                    'Item not found, not yours, or no longer pending.'
                );
            }

            const oldImagePath = rows[0].image_path;
            const newImagePath = req.file
                ? `/uploads/${req.file.filename}`
                : oldImagePath;

            const sql = `
                UPDATE items
                SET item_name = ?,
                    description = ?,
                    category = ?,
                    location = ?,
                    date_lost_or_found = ?,
                    report_type = ?,
                    image_path = ?
                WHERE id = ?
                  AND user_id = ?
                  AND status = 'Pending'
            `;

            db.query(sql, [
                itemName,
                description,
                category,
                location,
                date,
                reportType,
                newImagePath,
                itemId,
                req.session.user.id
            ], (err, result) => {
                if (err) {
                    console.error(err.message);
                    if (req.file) {
                        fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
                    }
                    return res.status(500).send('Could not update the item.');
                }

                if (result.affectedRows === 0) {
                    if (req.file) {
                        fs.unlink(path.join(uploadsDir, req.file.filename), () => {});
                    }
                    return res.status(404).send(
                        'Item not found, not yours, or no longer pending.'
                    );
                }

                if (req.file && oldImagePath) {
                    const oldFile = path.join(
                        uploadsDir,
                        path.basename(oldImagePath)
                    );
                    fs.unlink(oldFile, () => {});
                }

                res.redirect('/items');
            });
        }
    );
});


app.post('/items/:id/delete', requireLogin, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid item ID.');
    }

    const sql = `
        DELETE FROM items
        WHERE id = ?
          AND user_id = ?
          AND status = 'Pending'
    `;

    db.query(sql, [itemId, req.session.user.id], (err, result) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not delete the item.');
        }

        if (result.affectedRows === 0) {
            return res.status(404).send(
                'Item not found, not yours, or no longer pending.'
            );
        }

        res.redirect('/items');
    });
});

function getClaimItem(itemId, callback) {
    const sql = `
        SELECT items.id, items.user_id, items.item_name, items.description,
               items.category, items.location, items.report_type, items.status,
               items.image_path,
               DATE_FORMAT(items.date_lost_or_found, '%Y-%m-%d') AS item_date,
               users.name AS reporter_name
        FROM items
        JOIN users ON items.user_id = users.id
        WHERE items.id = ?
    `;

    db.query(sql, [itemId], (err, results) => {
        if (err) {
            return callback(err);
        }

        callback(null, results[0] || null);
    });
}

function buildClaimStatusMap(claimRows) {
    // Map each item to the claimant's active claim state.
    // A pending claim takes priority over an approved one.
    const statuses = {};

    claimRows.forEach((row) => {
        const itemId = Number(row.item_id);

        if (statuses[itemId] === 'Pending') {
            return;
        }

        statuses[itemId] = row.status;
    });

    return statuses;
}

function claimEligibilityError(item, user) {
    if (item.report_type !== 'Found') {
        return 'Only found items can be claimed.';
    }

    if (item.status === 'Pending') {
        return 'This item is still pending approval and cannot be claimed yet.';
    }

    if (item.status !== 'Approved') {
        return 'This item has already been claimed or returned.';
    }

    if (Number(item.user_id) === Number(user.id)) {
        return 'You cannot claim an item you reported yourself.';
    }

    return '';
}

function hasPendingClaim(itemId, claimantId, callback) {
    db.query(
        `SELECT id
         FROM claims
         WHERE item_id = ? AND claimant_id = ? AND status = 'Pending'
         LIMIT 1`,
        [itemId, claimantId],
        (err, results) => {
            if (err) {
                return callback(err);
            }

            callback(null, results.length > 0);
        }
    );
}

app.get('/items/:id/claim', requireLogin, (req, res) => {
    const itemId = Number(req.params.id);

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid item ID.');
    }

    if (req.session.user.role !== 'user') {
        return res.status(403).send('Only regular users can submit a claim.');
    }

    getClaimItem(itemId, (err, item) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load the item.');
        }

        if (!item) {
            return res.status(404).send('Item not found.');
        }

        const eligibilityError = claimEligibilityError(item, req.session.user);

        if (eligibilityError) {
            return res.redirect(
                `/items?claim_error=${encodeURIComponent(eligibilityError)}`
            );
        }

        hasPendingClaim(itemId, req.session.user.id, (claimErr, pending) => {
            if (claimErr) {
                console.error(claimErr.message);
                return res.status(500).send('Could not check existing claims.');
            }

            if (pending) {
                return res.redirect('/claims?notice=pending');
            }

            res.render('claim', {
                item,
                error: '',
                user: req.session.user,
                proof: '',
                contact: ''
            });
        });
    });
});

app.post('/items/:id/claim', requireLogin, (req, res) => {
    const itemId = Number(req.params.id);
    const proof = (req.body.proof || '').trim();
    const contact = (req.body.contact || '').trim();

    if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).send('Invalid item ID.');
    }

    if (req.session.user.role !== 'user') {
        return res.status(403).send('Only regular users can submit a claim.');
    }

    getClaimItem(itemId, (err, item) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not submit the claim.');
        }

        if (!item) {
            return res.status(404).send('Item not found.');
        }

        const eligibilityError = claimEligibilityError(item, req.session.user);

        if (eligibilityError) {
            return res.redirect(
                `/items?claim_error=${encodeURIComponent(eligibilityError)}`
            );
        }

        let formError = '';

        if (proof.length < 10 || proof.length > 1000) {
            formError =
                'Please describe your proof of ownership in 10 to 1000 characters.';
        } else if (contact.length > 150) {
            formError = 'Contact details must not exceed 150 characters.';
        }

        if (formError) {
            return res.status(400).render('claim', {
                item,
                error: formError,
                user: req.session.user,
                proof,
                contact
            });
        }

        // Re-check eligibility and insert while holding a row lock on the item
        // so two quick submissions cannot create duplicate pending claims.
        db.getConnection((connErr, connection) => {
            if (connErr) {
                console.error(connErr.message);
                return res.status(500).send('Could not submit the claim.');
            }

            connection.beginTransaction((beginErr) => {
                if (beginErr) {
                    console.error(beginErr.message);
                    connection.release();
                    return res.status(500).send('Could not submit the claim.');
                }

                const rollback = (statusCode, message) => {
                    connection.rollback(() => {
                        connection.release();
                        res.status(statusCode).send(message);
                    });
                };

                connection.query(
                    `SELECT id, user_id, report_type, status
                     FROM items
                     WHERE id = ?
                     FOR UPDATE`,
                    [itemId],
                    (lockErr, lockedRows) => {
                        if (lockErr) {
                            console.error(lockErr.message);
                            return rollback(500, 'Could not submit the claim.');
                        }

                        if (lockedRows.length === 0) {
                            return rollback(404, 'Item not found.');
                        }

                        const lockedItem = lockedRows[0];
                        const lockedError = claimEligibilityError(
                            lockedItem,
                            req.session.user
                        );

                        if (lockedError) {
                            return rollback(400, lockedError);
                        }

                    connection.query(
                        `SELECT id
                         FROM claims
                         WHERE item_id = ?
                           AND claimant_id = ?
                           AND status = 'Pending'
                         LIMIT 1`,
                        [itemId, req.session.user.id],
                        (dupErr, dupRows) => {
                            if (dupErr) {
                                console.error(dupErr.message);
                                return rollback(500, 'Could not submit the claim.');
                            }

                            if (dupRows.length > 0) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.redirect('/claims?notice=pending');
                                });
                            }

                            connection.query(
                                `INSERT INTO claims (item_id, claimant_id, proof, contact)
                                 VALUES (?, ?, ?, ?)`,
                                [
                                    itemId,
                                    req.session.user.id,
                                    proof,
                                    contact || null
                                ],
                                (insertErr) => {
                                    if (insertErr) {
                                        console.error(insertErr.message);
                                        return rollback(
                                            500,
                                            'Could not submit the claim.'
                                        );
                                    }

                                    connection.commit((commitErr) => {
                                        if (commitErr) {
                                            console.error(commitErr.message);
                                            return rollback(
                                                500,
                                                'Could not submit the claim.'
                                            );
                                        }

                                        connection.release();
                                        res.redirect('/claims?submitted=1');
                                    });
                                }
                            );
                        }
                    );
                }
                );
            });
            });
        });
    });

app.get('/claims', requireLogin, (req, res) => {
    const sql = `
        SELECT claims.id, claims.item_id, claims.proof, claims.contact, claims.status, claims.admin_note,
               DATE_FORMAT(claims.created_at, '%b %d, %Y %h:%i %p') AS submitted_at,
               DATE_FORMAT(claims.reviewed_at, '%b %d, %Y %h:%i %p') AS reviewed_at,
               items.item_name, items.location, items.category,
               items.status AS item_status, items.image_path,
               DATE_FORMAT(items.date_lost_or_found, '%Y-%m-%d') AS item_date,
               users.name AS reporter_name
        FROM claims
        JOIN items ON claims.item_id = items.id
        JOIN users ON items.user_id = users.id
        WHERE claims.claimant_id = ?
        ORDER BY claims.id DESC
    `;

    db.query(sql, [req.session.user.id], (err, claims) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Could not load your claims.');
        }

        res.render('claims', {
            user: req.session.user,
            claims,
            submitted: req.query.submitted === '1',
            notice: req.query.notice || ''
        });
    });
});

app.post('/claims/:id/cancel', requireLogin, (req, res) => {
    const claimId = Number(req.params.id);

    if (!Number.isInteger(claimId) || claimId < 1) {
        return res.status(400).send('Invalid claim ID.');
    }

    if (req.session.user.role !== 'user') {
        return res.status(403).send('Only students can cancel claim requests.');
    }

    db.query(
        `UPDATE claims
         SET status = 'Cancelled',
             reviewed_at = NOW(),
             reviewed_by = NULL,
             admin_note = NULL
         WHERE id = ? AND claimant_id = ? AND status = 'Pending'`,
        [claimId, req.session.user.id],
        (err, result) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Could not cancel the claim.');
            }

            if (result.affectedRows === 0) {
                return res.redirect('/claims?notice=cancel-failed');
            }

            res.redirect('/claims?notice=cancelled');
        }
    );
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
