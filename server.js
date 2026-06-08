require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

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

async function getData() {
    let doc = await AppData.findOne();
    if (!doc) doc = await AppData.create({ members: [], expenses: [] });
    return doc;
}

// ── Cloudinary ────────────────────────────────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cloudStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'chiatien-receipts',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
        transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
    },
});

const upload = multer({
    storage: cloudStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed'));
    },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
    const doc = await getData();
    res.json({ members: doc.members, expenses: doc.expenses });
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
    doc.expenses.set(idx, { ...doc.expenses[idx], ...req.body });
    doc.markModified('expenses');
    await doc.save();
    res.json(doc.expenses[idx]);
});

app.delete('/api/expenses/:id', async (req, res) => {
    const doc = await getData();
    const expense = doc.expenses.find(e => e.id === req.params.id);
    if (expense?.image?.includes('cloudinary.com')) {
        try {
            const afterUpload = expense.image.split('/upload/')[1];
            const withoutVersion = afterUpload.replace(/^v\d+\//, '');
            const publicId = withoutVersion.replace(/\.[^/.]+$/, '');
            await cloudinary.uploader.destroy(publicId);
        } catch {}
    }
    doc.expenses = doc.expenses.filter(e => e.id !== req.params.id);
    doc.markModified('expenses');
    await doc.save();
    res.json({ success: true });
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

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: req.file.path });
});

app.listen(PORT, () => {
    console.log(`\n🏠  Chia Tiền Nhà  →  http://localhost:${PORT}\n`);
});
