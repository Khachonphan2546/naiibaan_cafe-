const express = require('express');
const cors = require('cors');
const pool = require('./db');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

/* ================== CORS ================== */
app.use(cors({
    origin: ['https://naiibaan-cafe.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
});

/* ================== Static ================== */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

/* ================== Upload ================== */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = './public/uploads/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const safeName = Buffer.from(file.originalname, 'latin1')
            .toString('utf8')
            .replace(/[^a-zA-Z0-9.]/g, "_");
        cb(null, Date.now() + "_" + safeName);
    }
});
const upload = multer({ storage });

/* ================== Products ================== */
app.post('/api/products', upload.single('imageFile'), async (req, res) => {
    const { product_name, price, stock, category_id, drink_options, sub_category } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const catRes = await pool.query(
            'SELECT category_name FROM categories WHERE category_id=$1',
            [category_id]
        );
        const catName = catRes.rows[0]?.category_name || 'ทั่วไป';

        let prefix = 'PRO';
        if (catName === 'เครื่องดื่ม') prefix = 'DR';
        else if (catName === 'ขนมหวาน') prefix = 'DE';

        const last = await pool.query(
            'SELECT product_code FROM products WHERE product_code LIKE $1 ORDER BY product_id DESC LIMIT 1',
            [prefix + '%']
        );

        let num = 1;
        if (last.rows.length > 0) {
            const n = parseInt(last.rows[0].product_code.replace(prefix, ''));
            if (!isNaN(n)) num = n + 1;
        }

        const code = `${prefix}${num.toString().padStart(3, '0')}`;

        const result = await pool.query(
            `INSERT INTO products 
            (product_code, product_name, price, stock, category_id, image, drink_options, sub_category) 
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [code, product_name, price, stock, category_id, imagePath, drink_options, sub_category]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/products/:id', upload.single('imageFile'), async (req, res) => {
    const { id } = req.params;
    const { product_name, price, stock, category_id, drink_options, sub_category } = req.body;

    let query = 'UPDATE products SET product_name=$1,price=$2,stock=$3,category_id=$4,drink_options=$5,sub_category=$6';
    let params = [product_name, price, stock, category_id, drink_options, sub_category, id];

    if (req.file) {
        const imagePath = `/uploads/${req.file.filename}`;
        query += ',image=$7 WHERE product_id=$8';
        params = [product_name, price, stock, category_id, drink_options, sub_category, imagePath, id];
    } else {
        query += ' WHERE product_id=$7';
    }

    try {
        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE product_id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ================== Users ================== */
app.post('/api/users/staff', async (req, res) => {
    const { username, password, full_name, role, phone, email } = req.body;
    try {
        const r = await pool.query(
            'INSERT INTO users (username,password,full_name,role,phone,email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
            [username, password, full_name, role || 'staff', phone, email]
        );
        res.json({ success: true, user: r.rows[0] });
    } catch {
        res.status(500).json({ success: false });
    }
});

app.get('/api/users', async (req, res) => {
    const r = await pool.query(
        "SELECT user_id,username,full_name,role,phone,email FROM users WHERE role IN ('staff','owner') ORDER BY user_id DESC"
    );
    res.json(r.rows);
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    const r = await pool.query(
        'SELECT user_id,username,full_name,role,email FROM users WHERE (username=$1 OR email=$1) AND password=$2',
        [username, password]
    );

    if (r.rows.length)
        res.json({ success: true, user: r.rows[0] });
    else
        res.status(401).json({ success: false });
});

/* ================== Categories ================== */
app.get('/categories', async (req, res) => {
    const r = await pool.query('SELECT * FROM categories ORDER BY category_id ASC');
    res.json(r.rows);
});

/* ================== Products List ================== */
app.get('/products', async (req, res) => {
    const r = await pool.query(`
        SELECT p.*,c.category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id=c.category_id
        ORDER BY p.product_id DESC
    `);
    res.json(r.rows);
});

/* ================== Orders ================== */
app.post('/orders', async (req, res) => {
    const { total_price, items, payment_method, user_id } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const o = await client.query(
            'INSERT INTO orders(total_price,payment_method,user_id,status) VALUES($1,$2,$3,$4) RETURNING *',
            [total_price, payment_method || 'Cash', user_id, 'Pending']
        );

        for (const i of items) {
            await client.query(
                'INSERT INTO order_items(order_id,product_id,product_name,quantity,price) VALUES($1,$2,$3,$4,$5)',
                [o.rows[0].order_id, i.product_id, i.product_name, i.quantity, i.price]
            );

            await client.query(
                'UPDATE products SET stock=stock-$1 WHERE product_id=$2',
                [i.quantity, i.product_id]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

/* ================== Google Login ================== */
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/api/google-login', async (req, res) => {
    try {
        const ticket = await client.verifyIdToken({
            idToken: req.body.token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const { email, name } = ticket.getPayload();

        let u = await pool.query('SELECT * FROM users WHERE email=$1', [email]);

        if (!u.rows.length) {
            u = await pool.query(
                'INSERT INTO users(username,password,full_name,role,email) VALUES($1,$2,$3,$4,$5) RETURNING *',
                [email.split('@')[0], 'google', name, 'customer', email]
            );
        }

        res.json({ success: true, user: u.rows[0] });

    } catch (e) {
        res.status(400).json({ success: false });
    }
});

/* ================== START SERVER ================== */
app.listen(PORT, () => {
    console.log("🚀 Server running on port " + PORT);
});