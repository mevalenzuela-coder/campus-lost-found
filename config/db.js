const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Keep databases created from an older schema.sql working without a manual
// re-import. Each step is safe to run on every start.
function ensureSchema() {
    const claimsSql = `
        CREATE TABLE IF NOT EXISTS claims (
            id INT AUTO_INCREMENT PRIMARY KEY,
            item_id INT NOT NULL,
            claimant_id INT NOT NULL,
            proof TEXT NOT NULL,
            contact VARCHAR(150) NULL,
            status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled')
                NOT NULL DEFAULT 'Pending',
            admin_note VARCHAR(255) NULL,
            reviewed_by INT NULL,
            reviewed_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_claims_status (status),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (claimant_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `;

    db.query(claimsSql, (err) => {
        if (err) {
            console.error('Could not create the claims table:', err.message);
            return;
        }

        // Keep databases created from an older schema in sync with the
        // student cancellation workflow.
        db.query("SHOW COLUMNS FROM claims LIKE 'status'", (columnErr, rows) => {
            if (columnErr) {
                console.error(
                    'Could not inspect the claims table:',
                    columnErr.message
                );
                return;
            }

            if (rows.length === 0 || rows[0].Type.includes("'Cancelled'")) {
                return;
            }

            db.query(
                `ALTER TABLE claims
                 MODIFY COLUMN status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled')
                 NOT NULL DEFAULT 'Pending'`,
                (alterErr) => {
                    if (alterErr) {
                        console.error(
                            'Could not add the Cancelled claim status:',
                            alterErr.message
                        );
                        return;
                    }

                    console.log('Added Cancelled claim status.');
                }
            );
        });
    });

    db.query("SHOW COLUMNS FROM items LIKE 'image_path'", (err, rows) => {
        if (err) {
            console.error('Could not inspect the items table:', err.message);
            return;
        }

        if (rows.length > 0) {
            return;
        }

        db.query(
            'ALTER TABLE items ADD COLUMN image_path VARCHAR(255) NULL AFTER status',
            (alterErr) => {
                if (alterErr) {
                    console.error(
                        'Could not add items.image_path:',
                        alterErr.message
                    );
                    return;
                }

                console.log('Added items.image_path column.');
            }
        );
    });
}

db.query('SELECT 1', (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }

    console.log('Connected to MySQL!');
    ensureSchema();
});

module.exports = db;
