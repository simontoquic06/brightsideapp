const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

router.get('/', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!row) return res.json({});
  res.json({
    name: row.name,
    role: row.role,
    email: row.email,
    business: row.business,
    textNumber: row.text_number,
    area: row.area,
    photo: row.photo,
    msgTemplate: row.msg_template,
    reviewLink: row.review_link,
    qb: !!row.qb_connected,
    gcal: !!row.gcal_connected,
  });
});

router.put('/', (req, res) => {
  const db = getDb();
  const { name, role, email, business, textNumber, area, photo, msgTemplate, reviewLink } = req.body;
  db.prepare(`
    UPDATE settings SET
      name = COALESCE(?, name),
      role = COALESCE(?, role),
      email = COALESCE(?, email),
      business = COALESCE(?, business),
      text_number = COALESCE(?, text_number),
      area = COALESCE(?, area),
      photo = ?,
      msg_template = COALESCE(?, msg_template),
      review_link = COALESCE(?, review_link),
      updated_at = datetime('now')
    WHERE id = 1
  `).run(name, role, email, business, textNumber, area, photo ?? null, msgTemplate, reviewLink);
  res.json({ ok: true });
});

module.exports = router;
