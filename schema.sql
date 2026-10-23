
CREATE DATABASE IF NOT EXISTS campus_lost_found;
USE campus_lost_found;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    location VARCHAR(150) NOT NULL,
    date_lost_or_found DATE NOT NULL,
    report_type ENUM('Lost', 'Found') NOT NULL,
    status ENUM('Pending', 'Approved', 'Claimed', 'Returned')
        NOT NULL DEFAULT 'Pending',
    image_path VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
);
