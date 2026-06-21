const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

function formatClient(row, history) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    since: row.since,
    balance: row.balance,
    qb: !!row.qb_connected,
    commercial: !!row.commercial,
    notes: row.notes,
    history: history || [],
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const clients = db.prepare('SELECT * FROM clients ORDER BY name').all();
  const histStmt = db.prepare('SELECT * FROM service_history WHERE client_id = ? ORDER BY rowid DESC');
  res.json(clients.map(c => formatClient(c, histStmt.all(c.id))));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const history = db.prepare('SELECT * FROM service_history WHERE client_id = ? ORDER BY rowid DESC').all(client.id);
  res.json(formatClient(client, history));
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, phone, email, address, since, notes, commercial } = req.body;
  const id = 'c' + uuidv4().replace(/-/g, '').slice(0, 8);
  db.prepare(`
    INSERT INTO clients (id, name, phone, email, address, since, notes, commercial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, phone, email, address, since, notes, commercial ? 1 : 0);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, phone, email, address, since, notes, commercial, balance } = req.body;
  db.prepare(`
    UPDATE clients SET
      name = COALESCE(?, name), phone = COALESCE(?, phone), email = COALESCE(?, email),
      address = COALESCE(?, address), since = COALESCE(?, since), notes = COALESCE(?, notes),
      commercial = COALESCE(?, commercial), balance = COALESCE(?, balance),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, phone, email, address, since, notes, commercial != null ? (commercial ? 1 : 0) : null, balance, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
