require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (production) {
    console.error('SESSION_SECRET must be configured with at least 32 characters in production.');
    process.exit(1);
  }
  console.warn('WARNING: Set a unique SESSION_SECRET in .env before deployment.');
}
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: production ? [] : null
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));
app.use(express.json({ limit: '40kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use(session({
  name: 'hvs.sid',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret-please',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.resolve('./data'), table: 'sessions', concurrentDB: true }),
  cookie: {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' }
});
const csrfToken = () => require('crypto').randomBytes(24).toString('hex');
const requireAdmin = (req, res, next) => {
  if (!req.session || req.session.admin !== true) return res.status(401).json({ error: 'Authentication required.' });
  next();
};
const requireCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  if (!req.session.csrfToken || !token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Security token expired. Refresh the page and try again.' });
  }
  next();
};
const cleanText = (value, max, field) => {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const out = value.trim();
  if (out.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return out;
};
const parseOffer = (body) => {
  const title = cleanText(body.title, 80, 'Offer title');
  const description = cleanText(body.description || '', 500, 'Description');
  const buttonText = cleanText(body.button_text || 'BUY NOW', 30, 'Button text');
  const original = Number(body.original_price);
  const discounted = Number(body.discounted_price);
  const active = body.active === true || body.active === 1 || body.active === '1' || body.active === 'true';
  const expiry = body.expiry_date ? cleanText(body.expiry_date, 10, 'Expiry date') : null;
  if (!title) throw new Error('Offer title is required.');
  if (!Number.isSafeInteger(original) || original < 1 || original > 100000000) throw new Error('Original price must be a valid positive whole number.');
  if (!Number.isSafeInteger(discounted) || discounted < 0 || discounted >= original) throw new Error('Discounted price must be zero or more and lower than the original price.');
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error('Expiry date must be a valid date.');
  if (expiry && Number.isNaN(Date.parse(expiry + 'T23:59:59'))) throw new Error('Expiry date is invalid.');
  return { title, original_price: original, discounted_price: discounted, description, expiry_date: expiry, button_text: buttonText || 'BUY NOW', active: active ? 1 : 0 };
};
const offerPublic = row => ({
  ...row,
  discount_percent: Math.round((1 - row.discounted_price / row.original_price) * 100)
});
const settingMap = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all());
const getActiveOffers = () => db.prepare(`SELECT * FROM offers WHERE active=1 AND (expiry_date IS NULL OR expiry_date >= date('now','localtime')) ORDER BY id DESC`).all().map(offerPublic);

app.get('/api/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = csrfToken();
  res.json({ token: req.session.csrfToken });
});
app.get('/api/public', (req, res) => {
  const settings = settingMap();
  res.json({
    settings: {
      website_title: settings.website_title,
      main_group_url: settings.main_group_url,
      admin_telegram_url: settings.admin_telegram_url,
      default_membership_price: Number(settings.default_membership_price || 2000),
      homepage_announcement: settings.homepage_announcement || '',
      offer_visibility: settings.offer_visibility !== 'false',
      contact_button_label: settings.contact_button_label || 'CONTACT ADMIN'
    },
    offers: settings.offer_visibility === 'false' ? [] : getActiveOffers()
  });
});
app.get('/api/admin/session', (req, res) => {
  if (req.session.admin === true) {
    if (!req.session.csrfToken) req.session.csrfToken = csrfToken();
    return res.json({ authenticated: true, csrfToken: req.session.csrfToken });
  }
  res.json({ authenticated: false });
});
app.post('/api/admin/login', loginLimiter, requireCsrf, async (req, res) => {
  try {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const admin = db.prepare('SELECT password_hash FROM admin WHERE id=1').get();
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Unable to create secure session.' });
      req.session.admin = true;
      req.session.csrfToken = csrfToken();
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: 'Unable to save session.' });
        res.json({ success: true, csrfToken: req.session.csrfToken });
      });
    });
  } catch {
    res.status(500).json({ error: 'Login failed.' });
  }
});
app.post('/api/admin/logout', requireAdmin, requireCsrf, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('hvs.sid', { httpOnly: true, secure: production, sameSite: 'lax' });
    res.json({ success: true });
  });
});
app.use('/api/admin', requireAdmin, requireCsrf);

app.get('/api/admin/dashboard', (req, res) => {
  const rows = db.prepare('SELECT * FROM offers').all();
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    total: rows.length,
    active: rows.filter(x => x.active === 1 && (!x.expiry_date || x.expiry_date >= today)).length,
    inactive: rows.filter(x => x.active !== 1 || (x.expiry_date && x.expiry_date < today)).length,
    expiring: rows.filter(x => x.active === 1 && x.expiry_date && x.expiry_date >= today && x.expiry_date <= new Date(Date.now() + 7*86400000).toISOString().slice(0,10)).length,
    offers: rows.sort((a,b) => b.id-a.id).map(offerPublic),
    settings: settingMap()
  });
});
app.post('/api/admin/offers', (req, res) => {
  try {
    const o = parseOffer(req.body);
    const result = db.prepare(`INSERT INTO offers (title,original_price,discounted_price,description,expiry_date,button_text,active)
      VALUES (@title,@original_price,@discounted_price,@description,@expiry_date,@button_text,@active)`).run(o);
    res.status(201).json({ offer: offerPublic(db.prepare('SELECT * FROM offers WHERE id=?').get(result.lastInsertRowid)) });
  } catch (e) { res.status(400).json({ error: e.message || 'Unable to save offer.' }); }
});
app.put('/api/admin/offers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !db.prepare('SELECT id FROM offers WHERE id=?').get(id)) return res.status(404).json({ error: 'Offer not found.' });
    const o = parseOffer(req.body);
    db.prepare(`UPDATE offers SET title=@title,original_price=@original_price,discounted_price=@discounted_price,
      description=@description,expiry_date=@expiry_date,button_text=@button_text,active=@active,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...o, id });
    res.json({ offer: offerPublic(db.prepare('SELECT * FROM offers WHERE id=?').get(id)) });
  } catch (e) { res.status(400).json({ error: e.message || 'Unable to update offer.' }); }
});
app.delete('/api/admin/offers/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid offer ID.' });
  const result = db.prepare('DELETE FROM offers WHERE id=?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Offer not found.' });
  res.json({ success: true });
});
app.patch('/api/admin/offers/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const active = req.body.active === true || req.body.active === 1;
  const result = db.prepare('UPDATE offers SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(active ? 1 : 0, id);
  if (!result.changes) return res.status(404).json({ error: 'Offer not found.' });
  res.json({ success: true });
});
app.put('/api/admin/settings', (req, res) => {
  try {
    const b = req.body;
    const website_title = cleanText(b.website_title, 80, 'Website title');
    const homepage_announcement = cleanText(b.homepage_announcement || '', 240, 'Announcement');
    const contact_button_label = cleanText(b.contact_button_label || 'CONTACT ADMIN', 30, 'Contact button label');
    const price = Number(b.default_membership_price);
    if (!website_title) throw new Error('Website title is required.');
    if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) throw new Error('Default membership price must be a valid positive whole number.');
    const validUrl = value => {
      try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 't.me' || u.hostname.endsWith('.t.me')); } catch { return false; }
    };
    if (!validUrl(b.main_group_url)) throw new Error('Main Group must be a valid https://t.me URL.');
    if (!validUrl(b.admin_telegram_url)) throw new Error('Admin Telegram must be a valid https://t.me URL.');
    const values = {
      website_title, homepage_announcement, contact_button_label,
      default_membership_price: String(price),
      main_group_url: b.main_group_url,
      admin_telegram_url: b.admin_telegram_url,
      offer_visibility: b.offer_visibility === false || b.offer_visibility === 'false' ? 'false' : 'true'
    };
    const update = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const tx = db.transaction(() => Object.entries(values).forEach(([k,v]) => update.run(k,v)));
    tx();
    res.json({ settings: settingMap() });
  } catch (e) { res.status(400).json({ error: e.message || 'Unable to save settings.' }); }
});
app.post('/api/admin/password', async (req, res) => {
  try {
    const current = typeof req.body.current_password === 'string' ? req.body.current_password : '';
    const next = typeof req.body.new_password === 'string' ? req.body.new_password : '';
    const row = db.prepare('SELECT password_hash FROM admin WHERE id=1').get();
    if (!row || !(await bcrypt.compare(current, row.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (next.length < 12 || next.length > 200) return res.status(400).json({ error: 'New password must be 12–200 characters.' });
    if (next === current) return res.status(400).json({ error: 'Choose a different password.' });
    const hash = await bcrypt.hash(next, 12);
    db.prepare('UPDATE admin SET password_hash=?,password_changed_at=CURRENT_TIMESTAMP WHERE id=1').run(hash);
    req.session.destroy(err => {
      if (err) return res.status(500).json({ error: 'Password changed, but session could not be closed. Please sign in again.' });
      res.clearCookie('hvs.sid', { httpOnly: true, secure: production, sameSite: 'lax' });
      res.json({ success: true });
    });
  } catch { res.status(500).json({ error: 'Unable to change password.' }); }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: production ? '1h' : 0 }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});
app.listen(PORT, () => console.log(`HAMBAWA VIP SPECIAL running on port ${PORT}`));
