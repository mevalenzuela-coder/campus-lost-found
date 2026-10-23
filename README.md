# Campus Lost and Found System

## Project Description

The Campus Lost and Found System is a web-based application developed to help students and school personnel report and view lost and found items on campus. It provides a centralized place for item reports and allows administrators to review and approve submitted reports.

## Team Members

- Allysa Villanueva
- Edith Armillo
- Aljanmar Sacdal
- Melchor Jr. Valenzuela

## Features

User registration and login
Session management and logout
Report lost or found items with an optional photo
Item photos shown on the homepage, item list, claim page, and admin dashboard
View submitted item reports
Search item reports by name, description, category, and location
Filter item reports by Lost or Found type
Filter item reports by status
Input validation for forms
Submit claim requests for approved found items
Cancel pending claim requests
View personal claim history and claim status
Admin dashboard for reviewing pending item reports
Admin approval of pending item reports
Dedicated admin claims page for reviewing all claim requests
Admin approval or rejection of ownership claims
Mark claimed items as returned
Role-based access restrictions for admin pages
MySQL database for storing user and item information

## Technologies Used

- Node.js
- Express.js
- EJS
- MySQL
- HTML
- CSS
- JavaScript
- Git and GitHub

## Installation and Setup Instructions

### Prerequisites

Install the following tools:

- Node.js and npm
- XAMPP
- Visual Studio Code
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/mevalenzuela-coder/campus-lost-found.git
cd campus-lost-found
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up the Database

1. Open the XAMPP Control Panel.
2. Start Apache and MySQL.
3. Open phpMyAdmin at `http://localhost/phpmyadmin`.
4. Select the **Import** tab.
5. Choose the `schema.sql` file from the project folder.
6. Click **Import** or **Go** to create the `campus_lost_found` database and its required tables.

The database schema creates the `users`, `items`, and `claims` tables needed by the application.

The app also upgrades older databases automatically on startup: it creates the `claims` table if it is missing and adds the `items.image_path` column used for item photos. Uploaded images are stored in `public/uploads/`.

### 4. Configure Environment Variables

1. Copy `.env.example` and create a local file named `.env`.
2. Configure the database host, port, username, password, database name, and session secret according to your local setup.
3. Do not upload `.env` or disclose passwords and session secrets to GitHub.

### 5. Run the Application

Open the project folder in Visual Studio Code. In the terminal, run:

```bash
node app.js
```

Open `http://localhost:3000` in your browser.

## Test Accounts

Use the accounts created in the local database for testing.

- Regular user: use the registered user account.
- Administrator: use the configured administrator account.

For security, do not publish real passwords or private credentials in this README. If the instructor requires working test credentials, provide approved test-only accounts through the instructor's designated submission method.

## AI Assistance Disclosure

AI tools were used to assist with understanding instructions, troubleshooting errors, explaining code, and improving documentation. The team is responsible for reviewing, testing, and understanding the code and the final system.
