const express = require('express');
const router = express.Router();
const OAuthClient = require('intuit-oauth');
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

// ── OAuth helpers ────────────────────────────────────────────────────────────

function getOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    environment: process.env.QB_ENVIRONMENT || 'sandbox',
    redirectUri: `${process.env.PUBLIC_URL}/api/quickbooks/callback`,
  });
}

function getTokens() {
  return getDb().prepare('SELECT * FROM integration_tokens WHERE id = 1').get();
}

function saveTokens(token, realmId) {
  const db = getDb();
  db.prepare(`
    UPDATE integration_tokens SET
      qb_access_token = ?, qb_refresh_token = ?,
      qb_token_expiry = ?, qb_realm_id = COALESCE(?, qb_realm_id),
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

function qbBase() {
  return (process.env.QB_ENVIRONMENT || 'sandbox') === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

async function qbFetch(path, options = {}) {
  const stored = getTokens();
  if (!stored?.qb_access_token) throw new Error('QuickBooks not connected');

  // Refresh if expired
  if (stored.qb_token_expiry && new Date(stored.qb_token_expiry) < new Date()) {
    const oauthClient = getOAuthClient();
    oauthClient.setToken({ token_type: 'bearer', access_token: stored.qb_access_token, refresh_token: stored.qb_refresh_token, realmId: stored.qb_realm_id });
    const refreshed = await oauthClient.refresh();
    saveTokens(refreshed.getJson(), stored.qb_realm_id);
    stored.qb_access_token = refreshed.getJson().access_token;
    stored.qb_realm_id = refreshed.getJson().realmId || stored.qb_realm_id;
  }

  const fetch = require('node-fetch');
  const url = `${qbBase()}/v3/company/${stored.qb_realm_id}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${stored.qb_access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await resp.json();
  if (data?.Fault) throw new Error(data.Fault.Error?.[0]?.Message || 'QuickBooks API error');
  return data;
}

// ── OAuth routes ─────────────────────────────────────────────────────────────

router.post('/auth-url', (req, res) => {
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET)
    return res.status(503).json({ error: 'QuickBooks credentials not configured' });
  const url = getOAuthClient().authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'brightside-qb',
  });
  res.json({ url });
});

router.get('/callback', async (req, res) => {
  try {
    const oauthClient = getOAuthClient();
    const fullUrl = `${process.env.PUBLIC_URL}/api/quickbooks/callback?` + new URLSearchParams(req.query).toString();
    const tokenRes = await oauthClient.createToken(fullUrl);
    saveTokens(tokenRes.getJson(), req.query.realmId);
    res.redirect('/?qb_connected=1');
  } catch (err) {
    res.redirect('/?qb_error=' + encodeURIComponent(err.message));
  }
});

router.get('/status', (req, res) => {
  const s = getDb().prepare('SELECT qb_connected FROM settings WHERE id = 1').get();
  res.json({ connected: !!(s?.qb_connected) });
});

router.delete('/disconnect', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE integration_tokens SET qb_access_token=NULL,qb_refresh_token=NULL,qb_token_expiry=NULL,qb_realm_id=NULL,updated_at=datetime('now') WHERE id=1`).run();
  db.prepare(`UPDATE settings SET qb_connected=0,updated_at=datetime('now') WHERE id=1`).run();
  res.json({ ok: true });
});

// ── Money / summary ──────────────────────────────────────────────────────────

router.get('/summary', async (req, res) => {
  const db = getDb();
  const { period } = req.query;

  // Always return local data as baseline
  const localSummary = buildLocalSummary(db, period);

  try {
    // Pull invoices from QB
    const data = await qbFetch(`/query?query=${encodeURIComponent("SELECT * FROM Invoice MAXRESULTS 500")}&minorversion=65`);
    const invoices = data?.QueryResponse?.Invoice || [];

    // Pull payments from QB
    const payData = await qbFetch(`/query?query=${encodeURIComponent("SELECT * FROM Payment MAXRESULTS 500")}&minorversion=65`);
    const payments = payData?.QueryResponse?.Payment || [];

    const now = new Date();
    let sinceDate = null;
    if (period === 'month') sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === 'quarter') sinceDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else if (period === 'year') sinceDate = new Date(now.getFullYear(), 0, 1);

    const inPeriod = inv => !sinceDate || new Date(inv.TxnDate) >= sinceDate;

    const collected = payments.filter(inPeriod).reduce((s, p) => s + (p.TotalAmt || 0), 0);
    const outstanding = invoices.filter(i => (i.Balance || 0) > 0).reduce((s, i) => s + i.Balance, 0);
    const periodTotal = invoices.filter(inPeriod).reduce((s, i) => s + (i.TotalAmt || 0), 0);

    // By service — map invoice line items to service names
    const byService = {};
    invoices.filter(inPeriod).forEach(inv => {
      (inv.Line || []).forEach(line => {
        if (line.DetailType === 'SalesItemLineDetail') {
          const svc = line.SalesItemLineDetail?.ItemRef?.name || 'Other';
          byService[svc] = (byService[svc] || 0) + (line.Amount || 0);
        }
      });
    });

    // Monthly map (last 12 months)
    const monthly = {};
    invoices.forEach(inv => {
      const key = (inv.TxnDate || '').slice(0, 7);
      if (key) monthly[key] = (monthly[key] || 0) + (inv.TotalAmt || 0);
    });

    const outstanding_invoices = invoices
      .filter(i => (i.Balance || 0) > 0)
      .map(i => ({
        clientId: i.CustomerRef?.value,
        client: i.CustomerRef?.name || 'Unknown',
        invoiceId: i.Id,
        invoiceNum: i.DocNumber,
        amount: i.Balance,
        total: i.TotalAmt,
        dueDate: i.DueDate,
        qbLink: `https://app.qbo.intuit.com/app/invoice?txnId=${i.Id}`,
        qb: true,
      }));

    const recentPayments = payments
      .sort((a, b) => new Date(b.TxnDate) - new Date(a.TxnDate))
      .slice(0, 20)
      .map(p => ({
        client: p.CustomerRef?.name || 'Unknown',
        amount: p.TotalAmt,
        date: p.TxnDate,
        method: p.PaymentMethodRef?.name || 'Payment',
      }));

    res.json({ collected, outstanding, periodTotal, byService, monthly, outstanding_invoices, recentPayments, source: 'quickbooks' });
  } catch (err) {
    // Fall back to local data if QB fails
    res.json({ ...localSummary, source: 'local', qbError: err.message });
  }
});

function buildLocalSummary(db, period) {
  const now = new Date();
  let since = null;
  if (period === 'month') since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  else if (period === 'quarter') since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  else if (period === 'year') since = `${now.getFullYear()}-01-01`;

  const histRows = since
    ? db.prepare(`SELECT sh.*, c.name AS client_name FROM service_history sh LEFT JOIN clients c ON c.id=sh.client_id WHERE sh.date >= ? ORDER BY sh.rowid DESC`).all(since)
    : db.prepare(`SELECT sh.*, c.name AS client_name FROM service_history sh LEFT JOIN clients c ON c.id=sh.client_id ORDER BY sh.rowid DESC`).all();

  const allHist = db.prepare('SELECT * FROM service_history').all();
  const collected = allHist.filter(r => r.paid).reduce((s, r) => s + (r.amount_num || 0), 0);
  const outstanding = db.prepare('SELECT SUM(balance) AS t FROM clients WHERE balance>0').get()?.t || 0;
  const byService = {};
  histRows.forEach(r => { byService[r.service] = (byService[r.service] || 0) + (r.amount_num || 0); });
  const monthly = {};
  allHist.forEach(r => { const k = String(r.date).slice(0, 7); if (k) monthly[k] = (monthly[k] || 0) + (r.amount_num || 0); });
  const outstanding_invoices = db.prepare(`SELECT id,name,balance,qb_connected FROM clients WHERE balance>0`).all().map(c => ({ clientId: c.id, client: c.name, amount: c.balance, qb: !!c.qb_connected }));
  const recentPayments = histRows.slice(0, 20).map(r => ({ client: r.client_name, service: r.service, amount: r.amount, date: r.date }));
  return { collected, outstanding, periodTotal: histRows.reduce((s, r) => s + (r.amount_num || 0), 0), byService, monthly, outstanding_invoices, recentPayments };
}

// ── Invoice management ───────────────────────────────────────────────────────

// Create a QB invoice from a completed job
router.post('/invoice', async (req, res) => {
  const db = getDb();
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const job = db.prepare(`SELECT j.*,c.name AS client_name FROM jobs j LEFT JOIN clients c ON c.id=j.client_id WHERE j.id=?`).get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    // Find or create QB customer
    const custData = await qbFetch(`/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${job.client_name.replace(/'/g, "\\'")}' MAXRESULTS 1`)}`);
    let customerId = custData?.QueryResponse?.Customer?.[0]?.Id;

    if (!customerId) {
      const newCust = await qbFetch('/customer', {
        method: 'POST',
        body: JSON.stringify({ DisplayName: job.client_name }),
      });
      customerId = newCust?.Customer?.Id;
    }

    const amount = job.price_num || 0;
    const invoiceBody = {
      CustomerRef: { value: customerId },
      TxnDate: job.date,
      DueDate: job.date,
      Line: [{
        Amount: amount,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: job.service },
          Qty: 1,
          UnitPrice: amount,
        },
        Description: `${job.service} at ${job.address}`,
      }],
      CustomerMemo: { value: `Job on ${job.date} — ${job.service}` },
    };

    const result = await qbFetch('/invoice', { method: 'POST', body: JSON.stringify(invoiceBody) });
    const invoice = result?.Invoice;

    // Store QB invoice ID on job
    db.prepare(`UPDATE jobs SET google_event_id=google_event_id, updated_at=datetime('now') WHERE id=?`).run(jobId);
    db.prepare(`UPDATE clients SET qb_connected=1 WHERE id=?`).run(job.client_id);

    res.json({ ok: true, invoiceId: invoice?.Id, invoiceNum: invoice?.DocNumber, qbLink: `https://app.qbo.intuit.com/app/invoice?txnId=${invoice?.Id}` });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Mark an invoice paid in QB
router.post('/mark-paid', async (req, res) => {
  const db = getDb();
  const { clientId, invoiceId, amount } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Always update local balance
  db.prepare(`UPDATE clients SET balance=0, updated_at=datetime('now') WHERE id=?`).run(clientId);
  const paymentId = uuidv4();
  db.prepare('INSERT INTO payments (id,client_id,amount) VALUES (?,?,?)').run(paymentId, clientId, client.balance || amount || 0);

  // Try to record payment in QB too
  if (invoiceId) {
    try {
      // Get invoice to find customer ref
      const invData = await qbFetch(`/invoice/${invoiceId}`);
      const inv = invData?.Invoice;
      if (inv) {
        await qbFetch('/payment', {
          method: 'POST',
          body: JSON.stringify({
            CustomerRef: inv.CustomerRef,
            TotalAmt: inv.Balance,
            TxnDate: new Date().toISOString().slice(0, 10),
            Line: [{ Amount: inv.Balance, LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }] }],
          }),
        });
      }
    } catch (e) {
      console.warn('QB payment record failed (local still updated):', e.message);
    }
  }

  res.json({ ok: true, id: paymentId, amount: client.balance });
});

// ── Customer import from QB ───────────────────────────────────────────────────

router.get('/import-customers', async (req, res) => {
  const db = getDb();
  try {
    const data = await qbFetch(`/query?query=${encodeURIComponent("SELECT * FROM Customer WHERE Active = true MAXRESULTS 500")}&minorversion=65`);
    const customers = data?.QueryResponse?.Customer || [];

    const insert = db.prepare(`
      INSERT OR IGNORE INTO clients (id,name,phone,email,address,since,balance,notes,qb_connected,commercial)
      VALUES (@id,@name,@phone,@email,@address,@since,@balance,@notes,@qb_connected,@commercial)
    `);

    const toImport = customers.map(c => {
      const addr = c.BillAddr;
      return {
        id: 'c' + uuidv4().replace(/-/g, '').slice(0, 8),
        name: c.DisplayName || c.FullyQualifiedName || 'Unknown',
        phone: c.PrimaryPhone?.FreeFormNumber || null,
        email: c.PrimaryEmailAddr?.Address || null,
        address: addr ? [addr.Line1, addr.City, addr.CountrySubDivisionCode].filter(Boolean).join(', ') : null,
        since: c.CreateTime ? c.CreateTime.slice(0, 4) : String(new Date().getFullYear()),
        balance: parseFloat(c.Balance) || 0,
        notes: c.Notes || null,
        qb_connected: 1,
        commercial: c.CompanyName ? 1 : 0,
      };
    });

    db.transaction(list => list.forEach(c => insert.run(c)))(toImport);
    res.json({ imported: toImport.length, clients: toImport.map(c => ({ id: c.id, name: c.name })) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
