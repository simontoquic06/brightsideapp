require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const fs = require('fs');

// Auto-download Babel on startup if missing (needed by dc-runtime for JSX)
(function ensureBabelAsset() {
  const babelPath = path.join(__dirname, '../frontend/assets/babel.min.js');
  if (fs.existsSync(babelPath)) return;
  console.log('[startup] babel.min.js missing — downloading from npm registry...');
  const https = require('https');
  const url = 'https://registry.npmjs.org/@babel/standalone/-/standalone-7.26.4.tgz';
  // Simpler: use the unpkg CDN redirect via direct download
  const fetch = require('node-fetch');
  fetch('https://unpkg.com/@babel/standalone@7.26.4/babel.min.js')
    .then(r => r.text())
    .then(js => {
      fs.mkdirSync(path.dirname(babelPath), { recursive: true });
      fs.writeFileSync(babelPath, js);
      console.log('[startup] babel.min.js downloaded OK (' + Math.round(js.length / 1024) + 'KB)');
    })
    .catch(e => console.warn('[startup] Could not download babel.min.js:', e.message));
})();

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'brightside-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// API routes
app.use('/api/settings', require('./routes/settings'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/texts', require('./routes/texts'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/google', require('./routes/google'));
app.use('/api/quickbooks', require('./routes/quickbooks'));
app.use('/api/import', require('./routes/import'));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Serve logo assets
app.use('/assets', express.static(path.join(__dirname, '../frontend/assets')));

// Serve the frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Brightside backend running on http://localhost:${PORT}`);
});
