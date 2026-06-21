require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('./schema');
const { v4: uuidv4 } = require('uuid');

const db = getDb();

const clients = [
  { id:'c1', name:'Margaret Ellison', phone:'(519) 426-8841', email:'margaret.e@gmail.com', address:'14 Argyle St, Simcoe', since:'2021', balance:0, qb_connected:1, commercial:0, notes:'Gate code 4417. Friendly golden retriever in the yard — leave side gate closed.' },
  { id:'c2', name:'Tom Hardy', phone:'(226) 388-1192', email:'thardy@outlook.com', address:'88 Norfolk Ave, Port Dover', since:'2023', balance:180, qb_connected:1, commercial:0, notes:'Two-storey, ladder access tight on north side.' },
  { id:'c3', name:'Priya Anand', phone:'(519) 771-5520', email:'priya.anand@gmail.com', address:'22 Lynnwood Dr, Brantford', since:'2022', balance:0, qb_connected:1, commercial:0, notes:'Prefers afternoon appointments. Recurring quarterly house wash.' },
  { id:'c4', name:'Robert Chen', phone:'(548) 233-7741', email:'rchen.home@gmail.com', address:'410 Colborne St, Brantford', since:'2024', balance:0, qb_connected:0, commercial:0, notes:'Storefront + apartment above. Bill to numbered company.' },
  { id:'c5', name:'Delta Townhomes', phone:'(519) 900-4410', email:'pm@deltatownhomes.ca', address:'5 Donly Dr, Simcoe', since:'2023', balance:640, qb_connected:1, commercial:1, notes:'Property manager: Alan Doyle. 24-unit complex. Net-30 billing.' },
  { id:'c6', name:'The Whitfields', phone:'(519) 443-2210', email:'whitfield.fam@gmail.com', address:'7 Mill Pond Rd, Waterford', since:'2025', balance:0, qb_connected:0, commercial:0, notes:'New build. Soft wash only on vinyl siding.' },
  { id:'c7', name:'Joanne Mercer', phone:'(226) 555-0148', email:'jmercer@gmail.com', address:'2 Concession 5, Vanessa', since:'2021', balance:0, qb_connected:1, commercial:0, notes:'Home base neighbour. Loyal — refers often.' },
];

const history = [
  { client_id:'c1', date:'May 2, 2026', service:'Window Cleaning', amount:'$240', amount_num:240 },
  { client_id:'c1', date:'Nov 14, 2025', service:'Gutter Cleaning', amount:'$185', amount_num:185 },
  { client_id:'c1', date:'Aug 3, 2025', service:'Window Cleaning', amount:'$230', amount_num:230 },
  { client_id:'c2', date:'Apr 18, 2026', service:'House Washing', amount:'$430', amount_num:430 },
  { client_id:'c2', date:'Sep 9, 2025', service:'Gutter Cleaning', amount:'$180', amount_num:180 },
  { client_id:'c3', date:'Mar 30, 2026', service:'Soft Washing', amount:'$500', amount_num:500 },
  { client_id:'c3', date:'Dec 12, 2025', service:'Window Cleaning', amount:'$260', amount_num:260 },
  { client_id:'c3', date:'Jun 21, 2025', service:'House Washing', amount:'$520', amount_num:520 },
  { client_id:'c4', date:'Feb 8, 2026', service:'Window Cleaning', amount:'$150', amount_num:150 },
  { client_id:'c4', date:'Oct 2, 2025', service:'Window Cleaning', amount:'$150', amount_num:150 },
  { client_id:'c5', date:'May 20, 2026', service:'Power Washing', amount:'$640', amount_num:640 },
  { client_id:'c5', date:'Apr 5, 2026', service:'House Washing', amount:'$1,150', amount_num:1150 },
  { client_id:'c5', date:'Nov 2, 2025', service:'Gutter Cleaning', amount:'$880', amount_num:880 },
  { client_id:'c6', date:'Mar 1, 2026', service:'Soft Washing', amount:'$380', amount_num:380 },
  { client_id:'c7', date:'Apr 22, 2026', service:'Window Cleaning', amount:'$210', amount_num:210 },
  { client_id:'c7', date:'Jul 14, 2025', service:'Soft Washing', amount:'$340', amount_num:340 },
  { client_id:'c7', date:'May 1, 2025', service:'Window Cleaning', amount:'$200', amount_num:200 },
];

const jobs = [
  { id:'j1',  date:'2026-06-17', t:480,  time:'8:00',  ampm:'AM', dur:'2h',   service:'Window Cleaning', client_id:'c1', address:'14 Argyle St, Simcoe',         price:'$240',   price_num:240 },
  { id:'j2',  date:'2026-06-17', t:630,  time:'10:30', ampm:'AM', dur:'1.5h', service:'Gutter Cleaning', client_id:'c2', address:'88 Norfolk Ave, Port Dover',   price:'$180',   price_num:180 },
  { id:'j3',  date:'2026-06-17', t:780,  time:'1:00',  ampm:'PM', dur:'3h',   service:'House Washing',   client_id:'c3', address:'22 Lynnwood Dr, Brantford',    price:'$520',   price_num:520 },
  { id:'j4',  date:'2026-06-17', t:930,  time:'3:30',  ampm:'PM', dur:'2h',   service:'Power Washing',   client_id:'c5', address:'5 Donly Dr, Simcoe',           price:'$640',   price_num:640 },
  { id:'j5',  date:'2026-06-17', t:1020, time:'5:00',  ampm:'PM', dur:'1h',   service:'Window Cleaning', client_id:'c4', address:'410 Colborne St, Brantford',   price:'$150',   price_num:150 },
  { id:'j6',  date:'2026-06-18', t:540,  time:'9:00',  ampm:'AM', dur:'2h',   service:'Soft Washing',    client_id:'c6', address:'7 Mill Pond Rd, Waterford',    price:'$380',   price_num:380 },
  { id:'j7',  date:'2026-06-18', t:780,  time:'1:00',  ampm:'PM', dur:'2h',   service:'Window Cleaning', client_id:'c7', address:'2 Concession 5, Vanessa',      price:'$210',   price_num:210 },
  { id:'j8',  date:'2026-06-19', t:510,  time:'8:30',  ampm:'AM', dur:'4h',   service:'House Washing',   client_id:'c5', address:'5 Donly Dr, Simcoe',           price:'$1,150', price_num:1150 },
  { id:'j9',  date:'2026-06-22', t:600,  time:'10:00', ampm:'AM', dur:'2h',   service:'Gutter Cleaning', client_id:'c1', address:'14 Argyle St, Simcoe',         price:'$190',   price_num:190 },
  { id:'j10', date:'2026-06-24', t:540,  time:'9:00',  ampm:'AM', dur:'3h',   service:'Power Washing',   client_id:'c3', address:'22 Lynnwood Dr, Brantford',    price:'$560',   price_num:560 },
  { id:'j11', date:'2026-06-25', t:780,  time:'1:00',  ampm:'PM', dur:'1.5h', service:'Window Cleaning', client_id:'c4', address:'410 Colborne St, Brantford',   price:'$165',   price_num:165 },
  { id:'j12', date:'2026-06-26', t:570,  time:'9:30',  ampm:'AM', dur:'2h',   service:'Soft Washing',    client_id:'c7', address:'2 Concession 5, Vanessa',      price:'$340',   price_num:340 },
  { id:'j13', date:'2026-06-30', t:600,  time:'10:00', ampm:'AM', dur:'2.5h', service:'Window Cleaning', client_id:'c6', address:'7 Mill Pond Rd, Waterford',    price:'$290',   price_num:290 },
];

const insertClient = db.prepare(`
  INSERT OR REPLACE INTO clients (id, name, phone, email, address, since, balance, qb_connected, commercial, notes)
  VALUES (@id, @name, @phone, @email, @address, @since, @balance, @qb_connected, @commercial, @notes)
`);

const insertHistory = db.prepare(`
  INSERT OR IGNORE INTO service_history (client_id, date, service, amount, amount_num)
  VALUES (@client_id, @date, @service, @amount, @amount_num)
`);

const insertJob = db.prepare(`
  INSERT OR REPLACE INTO jobs (id, date, time, ampm, t, dur, service, client_id, address, price, price_num, status)
  VALUES (@id, @date, @time, @ampm, @t, @dur, @service, @client_id, @address, @price, @price_num, 'scheduled')
`);

const seedAll = db.transaction(() => {
  clients.forEach(c => insertClient.run(c));
  history.forEach(h => insertHistory.run(h));
  jobs.forEach(j => insertJob.run(j));
});

seedAll();
console.log('Database seeded with demo data.');
