const express = require('express');
const router = express.Router();
const OAuthClient = require('intuit-oauth');
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

function getOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    environment: process.env.QB_ENVIRONMENT || 'sandbox',
    redirectUri: `${process.env.PUBLIC_URL}/api/quickbooks/callback`,
  });
}

function getStoredTokens() {
  const db = getDb();
  return db.prepare('SELECT * FROM integration_tokens WHERE id = 1').get();
}

function saveTokens(token, realmId) {
  const db = getDb();
  db.prepare(`
    UPDATE integration_tokens SET
      qb_access_token = ?,
      qb_refresh_token = ?,
      qb_token_expiry = ?,
      qb_realm_id = COALESCE(?, qb_realm_id),
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    token.access_token,
    token.refresh_token,
    token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
    realmId || null
  );
  db.prepare("UPDATE settings SET qb_connected = 1, updated_at = datetime('now') WHERE id = 1").run();
}

async function getQBClient() {
  const stored = getStoredTokens();
  if (!stored?.qb_access_token) throw new Error('QuickBooks not connected');

  const oauthClient = getOAuthClient();
  oauthClient.setToken({
    token_type: 'bearer',
    access_token: stored.qb_access_token,
    refresh_token: stored.qb_refresh_token,
    realmId: stored.qb_realm_id,
  });

  if (stored.qb_token_expiry && new Date(stored.qb_token_expiry) < new Date()) {
    const tokenRes = await oauthClient.refresh();
    saveTokens(tokenRes.getJson(), stored.qb_realm_id);
    oauthClient.setToken(tokenRes.getJson());
  }

  return { oauthClient, realmId: stored.qb_realm_id };
}

function qbBaseUrl(environment) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

router.post('/auth-url', (req, res) => {
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return res.status(503).json({ error: 'QuickBooks credentials not configured' });
  }
  const oauthClient = getOAuthClient();
  const url = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'brightside-qb',
  });
  res.json({ url });
});

router.get('/callback', async (req, res) => {
  const { error, code, realmId } = req.query;
  if (error) return res.redirect('/?qb_error=' + encodeURIComponent(error));
  try {
    const oauthClient = getOAuthClient();
    const fullUrl = `${process.env.PUBLIC_URL}/api/quickbooks/callback?` + new URLSearchParams(req.query).toString();
    const tokenRes = await oauthClient.createToken(fullUrl);
    saveTokens(tokenRes.getJson(), realmId);
    res.redirect('/?qb_connected=1');
  } catch (err) {
    console.error('QB callback error:', err);
    res.redirect('/?qb_error=' + encodeURIComponent(err.message));
  }
});

router.get('/status', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT qb_connected FROM settings WHERE id = 1').get();
  res.json({ connected: !!(settings?.qb_connected) });
});

router.get('/summary', async (req, res) => {
  const db = getDb();
  try {
    const { oauthClient, realmId } = await getQBClient();
    const base = qbBaseUrl(process.env.QB_ENVIRONMENT || 'sandbox');
    const token = oauthClient.getToken().access_token;

    const fetch = require('node-fetch');
    const query = encodeURIComponent("SELECT * FROM Invoice WHERE TxnDate > '2024-01-01' MAXRESULTS 200");
    const resp = await fetch(`${base}/v3/company/${realmId}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const data = await resp.json();
    const invoices = data?.QueryResponse?.Invoice || [];

    const collected = invoices.filter(i => i.Balance === 0).reduce((s, i) => s + (i.TotalAmt || 0), 0);
    const outstanding = invoices.filter(i => i.Balance > 0).reduce((s, i) => s + (i.Balance || 0), 0);

    res.json({ collected, outstanding, invoiceCount: invoices.length, source: 'quickbooks' });
  } catch (err) {
    const fallback = db.prepare(`
      SELECT SUM(amount_num) AS total FROM service_history WHERE paid = 1
    `).get();
    const outstandingFallback = db.prepare('SELECT SUM(balance) AS total FROM clients WHERE balance > 0').get();
    res.json({
      collected: fallback?.total || 0,
      outstanding: outstandingFallback?.total || 0,
      source: 'local',
      error: err.message,
    });
  }
});

router.post('/mark-paid', async (req, res) => {
  const db = getDb();
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client || !client.balance) return res.json({ ok: true });

  db.prepare("UPDATE clients SET balance = 0, updated_at = datetime('now') WHERE id = ?").run(clientId);

  const id = uuidv4();
  db.prepare('INSERT INTO payments (id, client_id, amount) VALUES (?, ?, ?)').run(id, clientId, client.balance);

  res.json({ ok: true, id, amount: client.balance });
});

router.delete('/disconnect', (req, res) => {
  const db = getDb();
  db.prepare(`
    UPDATE integration_tokens SET
      qb_access_token = NULL, qb_refresh_token = NULL,
      qb_token_expiry = NULL, qb_realm_id = NULL, updated_at = datetime('now')
    WHERE id = 1
  `).run();
  db.prepare("UPDATE settings SET qb_connected = 0, updated_at = datetime('now') WHERE id = 1").run();
  res.json({ ok: true });
});

module.exports = router;
