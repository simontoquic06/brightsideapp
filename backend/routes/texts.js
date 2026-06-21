const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const TEXT_KINDS = {
  onway:    { label: "On our way",    setStatus: null },
  arrived:  { label: "We've started", setStatus: 'started' },
  finished: { label: 'Job finished',  setStatus: 'done' },
  review:   { label: 'Review request', setStatus: null },
};

function buildMessage(job, client, settings, kind) {
  const first = (client.name || '').split(' ')[0] || 'there';
  const ownerFirst = (settings.name || '').split(' ')[0] || 'there';
  const biz = settings.business || 'Brightside';
  const svc = (job.service || '').toLowerCase();
  if (kind === 'onway') {
    return `Hi ${first}, this is ${ownerFirst} from ${biz} — we're on our way for your ${svc} and should arrive shortly. See you soon!`;
  }
  if (kind === 'finished') {
    return `Hi ${first}, we've just finished your ${svc} — thanks so much for choosing ${biz}! Everything's wrapped up. Please let us know if you need anything else.`;
  }
  if (kind === 'review') {
    return `Hi ${first}, thanks again for choosing ${biz}! If you were happy with your ${svc}, we'd really appreciate a quick Google review: ${settings.review_link || settings.reviewLink || ''}`;
  }
  return String(settings.msg_template || settings.msgTemplate || '')
    .replace(/\{first\}/g, first)
    .replace(/\{owner\}/g, ownerFirst)
    .replace(/\{business\}/g, biz)
    .replace(/\{service\}/g, svc);
}

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT st.*, c.name AS client_name
    FROM sent_texts st
    LEFT JOIN clients c ON c.id = st.client_id
    ORDER BY st.sent_at DESC
    LIMIT 100
  `).all();
  res.json(rows.map(r => ({
    id: r.id,
    clientId: r.client_id,
    client: r.client_name,
    jobId: r.job_id,
    kind: r.kind,
    label: r.label,
    message: r.message,
    sentAt: r.sent_at,
  })));
});

router.post('/send', async (req, res) => {
  const db = getDb();
  const { jobId, kind } = req.body;
  if (!jobId || !kind || !TEXT_KINDS[kind]) {
    return res.status(400).json({ error: 'jobId and valid kind required' });
  }

  const job = db.prepare(`
    SELECT j.*, c.name AS client_name, c.phone AS client_phone
    FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = ?
  `).get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const client = { name: job.client_name, phone: job.client_phone };
  const message = buildMessage(job, client, settings, kind);
  const meta = TEXT_KINDS[kind];
  const id = uuidv4();
  let twilioSid = null;

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && client.phone) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const toNumber = client.phone.replace(/[^\d+]/g, '');
      const formatted = toNumber.startsWith('+') ? toNumber : '+1' + toNumber;
      const msg = await twilio.messages.create({
        body: message,
        from: process.env.TWILIO_FROM_NUMBER,
        to: formatted,
      });
      twilioSid = msg.sid;
    } catch (err) {
      console.error('Twilio error:', err.message);
      return res.status(502).json({ error: 'SMS failed: ' + err.message });
    }
  }

  db.prepare(`
    INSERT INTO sent_texts (id, client_id, job_id, kind, label, message, to_number, twilio_sid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, job.client_id, jobId, kind, meta.label, message, client.phone, twilioSid);

  if (meta.setStatus) {
    db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(meta.setStatus, jobId);
  }

  res.json({ ok: true, id, message, twilioSid, status: meta.setStatus });
});

router.post('/preview', (req, res) => {
  const db = getDb();
  const { jobId, kind } = req.body;
  if (!jobId || !kind) return res.status(400).json({ error: 'jobId and kind required' });
  const job = db.prepare(`
    SELECT j.*, c.name AS client_name, c.phone AS client_phone
    FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = ?
  `).get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const client = { name: job.client_name, phone: job.client_phone };
  res.json({ message: buildMessage(job, client, settings, kind) });
});

module.exports = router;
