const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

function formatJob(row) {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    ampm: row.ampm,
    t: row.t,
    dur: row.dur,
    service: row.service,
    clientId: row.client_id,
    client: row.client_name || '',
    address: row.address,
    price: row.price,
    priceNum: row.price_num,
    status: row.status || 'scheduled',
    googleEventId: row.google_event_id,
  };
}

const JOIN = `
  SELECT j.*, c.name AS client_name
  FROM jobs j
  LEFT JOIN clients c ON c.id = j.client_id
`;

router.get('/', (req, res) => {
  const db = getDb();
  const { date, month } = req.query;
  let rows;
  if (date) {
    rows = db.prepare(JOIN + ' WHERE j.date = ? ORDER BY j.t').all(date);
  } else if (month) {
    rows = db.prepare(JOIN + " WHERE j.date LIKE ? ORDER BY j.date, j.t").all(month + '%');
  } else {
    rows = db.prepare(JOIN + ' ORDER BY j.date, j.t').all();
  }
  res.json(rows.map(formatJob));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(JOIN + ' WHERE j.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(formatJob(row));
});

router.post('/', (req, res) => {
  const db = getDb();
  const { date, time, ampm, t, dur, service, clientId, address, price, priceNum } = req.body;
  const id = 'j' + uuidv4().replace(/-/g, '').slice(0, 8);
  db.prepare(`
    INSERT INTO jobs (id, date, time, ampm, t, dur, service, client_id, address, price, price_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, time, ampm, t, dur, service, clientId, address, price, priceNum || 0);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { date, time, ampm, t, dur, service, clientId, address, price, priceNum, status, googleEventId } = req.body;
  db.prepare(`
    UPDATE jobs SET
      date = COALESCE(?, date), time = COALESCE(?, time), ampm = COALESCE(?, ampm),
      t = COALESCE(?, t), dur = COALESCE(?, dur), service = COALESCE(?, service),
      client_id = COALESCE(?, client_id), address = COALESCE(?, address),
      price = COALESCE(?, price), price_num = COALESCE(?, price_num),
      status = COALESCE(?, status), google_event_id = COALESCE(?, google_event_id),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(date, time, ampm, t, dur, service, clientId, address, price, priceNum, status, googleEventId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
