const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

router.get('/summary', (req, res) => {
  const db = getDb();
  const { period } = req.query;

  const now = new Date();
  let since = null;
  if (period === 'month') {
    since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    since = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
  } else if (period === 'year') {
    since = `${now.getFullYear()}-01-01`;
  }

  let histRows;
  if (since) {
    histRows = db.prepare(`
      SELECT sh.*, c.name AS client_name
      FROM service_history sh
      LEFT JOIN clients c ON c.id = sh.client_id
      WHERE sh.date >= ?
      ORDER BY sh.rowid DESC
    `).all(since);
  } else {
    histRows = db.prepare(`
      SELECT sh.*, c.name AS client_name
      FROM service_history sh
      LEFT JOIN clients c ON c.id = sh.client_id
      ORDER BY sh.rowid DESC
    `).all();
  }

  const allHistRows = db.prepare('SELECT * FROM service_history').all();
  const collected = allHistRows.filter(r => r.paid).reduce((s, r) => s + (r.amount_num || 0), 0);

  const outstanding = db.prepare('SELECT SUM(balance) AS total FROM clients WHERE balance > 0').get()?.total || 0;

  const byService = {};
  histRows.forEach(r => {
    if (!byService[r.service]) byService[r.service] = 0;
    byService[r.service] += r.amount_num || 0;
  });

  const monthlyMap = {};
  allHistRows.forEach(r => {
    const key = String(r.date).slice(0, 7);
    if (!monthlyMap[key]) monthlyMap[key] = 0;
    monthlyMap[key] += r.amount_num || 0;
  });

  const outstanding_invoices = db.prepare(`
    SELECT id, name, balance, qb_connected FROM clients WHERE balance > 0
  `).all().map(c => ({
    clientId: c.id,
    client: c.name,
    amount: c.balance,
    qb: !!c.qb_connected,
  }));

  res.json({
    collected,
    outstanding,
    periodTotal: histRows.reduce((s, r) => s + (r.amount_num || 0), 0),
    byService,
    monthly: monthlyMap,
    outstanding_invoices,
    recentPayments: histRows.slice(0, 20).map(r => ({
      client: r.client_name,
      service: r.service,
      amount: r.amount,
      date: r.date,
    })),
  });
});

router.post('/mark-paid', (req, res) => {
  const db = getDb();
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.balance) return res.json({ ok: true, message: 'No balance' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO payments (id, client_id, amount) VALUES (?, ?, ?)
  `).run(id, clientId, client.balance);

  db.prepare("UPDATE clients SET balance = 0, updated_at = datetime('now') WHERE id = ?").run(clientId);

  res.json({ ok: true, id, amount: client.balance });
});

module.exports = router;
