const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'brightside.db');

let db;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'Seth Brightside',
      role TEXT NOT NULL DEFAULT 'Owner',
      email TEXT DEFAULT 'seth@brightsidehome.ca',
      business TEXT DEFAULT 'Brightside Home Services',
      text_number TEXT DEFAULT '(519) 718-0042',
      area TEXT DEFAULT 'Norfolk County, ON',
      photo TEXT,
      msg_template TEXT DEFAULT 'Hi {first}, this is {owner} from {business} — we''ve just arrived and started your {service} today. We''ll text you again once everything''s done. Thanks!',
      review_link TEXT DEFAULT 'https://g.page/r/brightside-home-services/review',
      qb_connected INTEGER DEFAULT 0,
      gcal_connected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS integration_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_token_expiry TEXT,
      google_calendar_id TEXT DEFAULT 'primary',
      qb_access_token TEXT,
      qb_refresh_token TEXT,
      qb_token_expiry TEXT,
      qb_realm_id TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      since TEXT,
      balance REAL DEFAULT 0,
      qb_connected INTEGER DEFAULT 0,
      commercial INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT,
      ampm TEXT,
      t INTEGER,
      dur TEXT,
      service TEXT,
      client_id TEXT REFERENCES clients(id),
      address TEXT,
      price TEXT,
      price_num REAL DEFAULT 0,
      status TEXT DEFAULT 'scheduled',
      google_event_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL REFERENCES clients(id),
      date TEXT NOT NULL,
      service TEXT NOT NULL,
      amount TEXT NOT NULL,
      amount_num REAL DEFAULT 0,
      paid INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sent_texts (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES clients(id),
      job_id TEXT REFERENCES jobs(id),
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      message TEXT,
      to_number TEXT,
      twilio_sid TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      job_id TEXT,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'cash',
      qb_payment_id TEXT,
      paid_at TEXT DEFAULT (datetime('now')),
      notes TEXT
    );

    -- Insert default settings row if not present
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    INSERT OR IGNORE INTO integration_tokens (id) VALUES (1);
  `);
}

module.exports = { getDb };
