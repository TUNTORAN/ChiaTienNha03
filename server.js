require('dotenv').config();

const express    = require('express');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const mongoose   = require('mongoose');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chiatiennha')
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB error:', err));

const AppDataSchema = new mongoose.Schema({
    members:  [String],
    expenses: [{ type: mongoose.Schema.Types.Mixed }],
});
const AppData = mongoose.model('AppData', AppDataSchema);

const AuditLogSchema = new mongoose.Schema({
    action:          { type: String, enum: ['add', 'edit', 'delete', 'restore'] },
    expenseId:       String,
    expenseSnapshot: mongoose.Schema.Types.Mixed,
    timestamp:       { type: Date, default: Date.now },
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

async function getData() {
    let doc = await AppData.findOne();
    if (!doc) doc = await AppData.create({ members: [], expenses: [] });
    return doc;
}

// ── Local image storage ───────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename:    (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    },
});

const upload = multer({
    storage: diskStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed'));
    },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
    const doc = await getData();
    res.json({ members: doc.members, expenses: doc.expenses.filter(e => !e.deleted) });
});

app.post('/api/expenses', async (req, res) => {
    const { person, amount, description, date } = req.body;
    const amt = parseInt(amount, 10);
    if (!person || !description || !date || isNaN(amt) || amt <= 0)
        return res.status(400).json({ error: 'Thiếu hoặc sai dữ liệu hóa đơn' });
    const expense = { id: uuidv4(), createdAt: new Date().toISOString(), ...req.body, amount: amt };
    const doc = await getData();
    doc.expenses.push(expense);
    doc.markModified('expenses');
    await doc.save();
    await AuditLog.create({ action: 'add', expenseId: expense.id, expenseSnapshot: expense });
    res.json(expense);
});

app.put('/api/expenses/:id', async (req, res) => {
    const { amount } = req.body;
    if (amount !== undefined) {
        const amt = parseInt(amount, 10);
        if (isNaN(amt) || amt <= 0)
            return res.status(400).json({ error: 'Số tiền không hợp lệ' });
        req.body.amount = amt;
    }
    const doc = await getData();
    const idx = doc.expenses.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const before = { ...doc.expenses[idx] };
    doc.expenses.set(idx, { ...doc.expenses[idx], ...req.body });
    doc.markModified('expenses');
    await doc.save();
    await AuditLog.create({ action: 'edit', expenseId: req.params.id, expenseSnapshot: { before, after: doc.expenses[idx] } });
    res.json(doc.expenses[idx]);
});

// Soft delete — đánh dấu deleted thay vì xóa thật
app.delete('/api/expenses/:id', async (req, res) => {
    const doc = await getData();
    const idx = doc.expenses.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const expense = { ...doc.expenses[idx] };
    doc.expenses.set(idx, { ...expense, deleted: true, deletedAt: new Date().toISOString() });
    doc.markModified('expenses');
    await doc.save();
    await AuditLog.create({ action: 'delete', expenseId: req.params.id, expenseSnapshot: expense });
    res.json({ success: true });
});

// Khôi phục hóa đơn đã xóa
app.put('/api/expenses/:id/restore', async (req, res) => {
    const doc = await getData();
    const idx = doc.expenses.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const exp = { ...doc.expenses[idx] };
    delete exp.deleted;
    delete exp.deletedAt;
    doc.expenses.set(idx, exp);
    doc.markModified('expenses');
    await doc.save();
    await AuditLog.create({ action: 'restore', expenseId: req.params.id, expenseSnapshot: exp });
    res.json({ success: true });
});

app.get('/api/deleted-expenses', async (req, res) => {
    const doc = await getData();
    res.json(doc.expenses.filter(e => e.deleted));
});

app.get('/api/audit-log', async (req, res) => {
    const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(200);
    res.json(logs);
});

app.post('/api/members', async (req, res) => {
    const { name } = req.body;
    const doc = await getData();
    if (!name || doc.members.includes(name))
        return res.status(400).json({ error: 'Invalid or duplicate name' });
    doc.members.push(name);
    await doc.save();
    res.json({ members: doc.members });
});

app.delete('/api/members/:name', async (req, res) => {
    const doc = await getData();
    doc.members = doc.members.filter(m => m !== decodeURIComponent(req.params.name));
    await doc.save();
    res.json({ members: doc.members });
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const localUrl = `/uploads/${req.file.filename}`;
    let backupUrl  = null;

    try {
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'chiatien-receipts',
            transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
        });
        backupUrl = result.secure_url;
    } catch (err) {
        console.warn('Cloudinary backup failed:', err.message);
    }

    res.json({ url: localUrl, backup: backupUrl });
});

app.listen(PORT, () => {
    console.log(`\n🏠  Chia Tiền Nhà  →  http://localhost:${PORT}\n`);
});
