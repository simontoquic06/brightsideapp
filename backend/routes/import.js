const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { getDb } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const HEADER_MAP = {
  'name': 'name', 'full name': 'name', 'customer name': 'name', 'client name': 'name',
  'display name': 'name', 'company name': 'name', 'company': 'name',
  'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone', 'cell': 'phone',
  'telephone': 'phone', 'main phone': 'phone', 'work phone': 'phone', 'mobile phone': 'phone',
  'email': 'email', 'email address': 'email', 'e-mail': 'email',
  'address': 'address', 'billing address': 'address', 'street': 'address',
  'full address': 'address', 'mailing address': 'address', 'street address': 'address',
  'notes': 'notes', 'note': 'notes', 'comments': 'notes', 'memo': 'notes', 'description': 'notes',
  'balance': 'balance', 'open balance': 'balance', 'amount due': 'balance', 'outstanding': 'balance',
  'since': 'since', 'customer since': 'since', 'member since': 'since', 'created': 'since', 'year': 'since',
};

function normaliseHeader(h) {
  return HEADER_MAP[(h || '').toLowerCase().trim()] || null;
}

function parseRows(rows) {
  if (!rows || rows.length < 2) return { clients: [], skipped: 0 };
  const headers = rows[0].map(h => String(h || '').trim());
  const fieldMap = headers.map(normaliseHeader);

  const clients = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(cell => !cell)) continue; // skip blank rows
    const obj = {};
    fieldMap.forEach((field, idx) => { if (field) obj[field] = String(row[idx] || '').trim(); });
    if (!obj.name) { skipped++; continue; }
    clients.push({
      id: 'c' + uuidv4().replace(/-/g, '').slice(0, 8),
      name: obj.name,
      phone: obj.phone || null,
      email: obj.email || null,
      address: obj.address || null,
      since: obj.since ? String(obj.since).slice(0, 4) : String(new Date().getFullYear()),
      balance: parseFloat(obj.balance) || 0,
      notes: obj.notes || null,
      qb_connected: 0,
      commercial: 0,
    });
  }
  return { clients, skipped };
}

// POST /api/import/csv — accepts .csv or .xlsx
router.post('/csv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file: ' + e.message });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const { clients, skipped } = parseRows(rows);
  if (!clients.length) {
    return res.status(400).json({
      error: 'No valid clients found. Make sure there is a header row with at least a "Name" column.',
    });
  }
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO clients (id,name,phone,email,address,since,balance,notes,qb_connected,commercial)
    VALUES (@id,@name,@phone,@email,@address,@since,@balance,@notes,@qb_connected,@commercial)
  `);
  db.transaction(list => list.forEach(c => insert.run(c)))(clients);
  res.json({ imported: clients.length, skipped, clients: clients.map(c => ({ id: c.id, name: c.name })) });
});

// GET /api/import/template — download blank xlsx template
router.get('/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Phone', 'Email', 'Address', 'Notes', 'Balance', 'Since'],
    ['Jane Smith', '(519) 555-0101', 'jane@example.com', '123 Main St, Simcoe', 'Regular customer', '0', '2023'],
    ['Delta Townhomes', '(519) 555-0202', 'pm@delta.ca', '5 Donly Dr, Simcoe', 'Commercial — net-30', '640', '2022'],
  ]);
  // Column widths
  ws['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 28 }, { wch: 35 }, { wch: 30 }, { wch: 12 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="brightside-clients-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
