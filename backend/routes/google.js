const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { getDb } = require('../db/schema');

function getOAuthClient() {
  const redirectUri = `${process.env.PUBLIC_URL}/api/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function getStoredTokens() {
  const db = getDb();
  return db.prepare('SELECT * FROM integration_tokens WHERE id = 1').get();
}

function saveTokens(tokens) {
  const db = getDb();
  db.prepare(`
    UPDATE integration_tokens SET
      google_access_token = ?,
      google_refresh_token = COALESCE(?, google_refresh_token),
      google_token_expiry = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null);
  db.prepare("UPDATE settings SET gcal_connected = 1, updated_at = datetime('now') WHERE id = 1").run();
}

async function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient();
  const stored = getStoredTokens();
  if (!stored?.google_access_token) throw new Error('Google not connected');
  oauth2Client.setCredentials({
    access_token: stored.google_access_token,
    refresh_token: stored.google_refresh_token,
    expiry_date: stored.google_token_expiry ? new Date(stored.google_token_expiry).getTime() : undefined,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) saveTokens(tokens);
  });
  return oauth2Client;
}

router.post('/auth-url', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google credentials not configured' });
  }
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.json({ url });
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?gcal_error=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?gcal_error=no_code');
  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    saveTokens(tokens);
    res.redirect('/?gcal_connected=1');
  } catch (err) {
    console.error('Google callback error:', err);
    res.redirect('/?gcal_error=' + encodeURIComponent(err.message));
  }
});

router.get('/status', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT gcal_connected FROM settings WHERE id = 1').get();
  res.json({ connected: !!(settings?.gcal_connected) });
});

router.post('/sync', async (req, res) => {
  try {
    const auth = await getAuthenticatedClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const db = getDb();

    const jobs = db.prepare(`
      SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
      FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
      WHERE j.date >= date('now') ORDER BY j.date, j.t
    `).all();

    const results = [];
    for (const job of jobs) {
      const [year, month, day] = job.date.split('-').map(Number);
      const [hourStr, minStr] = job.time.split(':');
      let hour = parseInt(hourStr);
      const min = parseInt(minStr);
      if (job.ampm === 'PM' && hour !== 12) hour += 12;
      if (job.ampm === 'AM' && hour === 12) hour = 0;

      const startDt = new Date(year, month - 1, day, hour, min);
      const durHours = parseFloat(job.dur) || 1;
      const endDt = new Date(startDt.getTime() + durHours * 60 * 60 * 1000);

      const event = {
        summary: `${job.service} — ${job.client_name}`,
        description: `Address: ${job.address}\nPrice: ${job.price}\nClient phone: ${job.client_phone || ''}`,
        start: { dateTime: startDt.toISOString(), timeZone: 'America/Toronto' },
        end: { dateTime: endDt.toISOString(), timeZone: 'America/Toronto' },
      };

      try {
        if (job.google_event_id) {
          await calendar.events.update({
            calendarId: 'primary',
            eventId: job.google_event_id,
            requestBody: event,
          });
          results.push({ jobId: job.id, action: 'updated' });
        } else {
          const created = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
          db.prepare("UPDATE jobs SET google_event_id = ? WHERE id = ?").run(created.data.id, job.id);
          results.push({ jobId: job.id, action: 'created', eventId: created.data.id });
        }
      } catch (e) {
        results.push({ jobId: job.id, action: 'error', error: e.message });
      }
    }

    res.json({ ok: true, synced: results.length, results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/disconnect', async (req, res) => {
  const db = getDb();
  const stored = getStoredTokens();
  if (stored?.google_access_token) {
    try {
      const oauth2Client = getOAuthClient();
      await oauth2Client.revokeToken(stored.google_access_token);
    } catch (e) { /* ignore revoke errors */ }
  }
  db.prepare(`
    UPDATE integration_tokens SET
      google_access_token = NULL, google_refresh_token = NULL,
      google_token_expiry = NULL, updated_at = datetime('now')
    WHERE id = 1
  `).run();
  db.prepare("UPDATE settings SET gcal_connected = 0, updated_at = datetime('now') WHERE id = 1").run();
  res.json({ ok: true });
});

module.exports = router;
