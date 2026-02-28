const express = require('express');
const cors = require('cors');
const pool = require('./db');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const port = process.env.PORT || 3001;


// รวม CORS ไว้เป็นอันเดียวแบบนี้ครับ
app.use(cors({
    origin: ['https://naiibaan-cafe.vercel.app', 'http://localhost:3000'], // ยอมรับทั้งเว็บจริงและตอนจูนรันในเครื่อง
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// เกราะป้องกันกรณี req.body เป็นค่าว่าง
app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
});

// 2. เปิดการเข้าถึงโฟลเดอร์สาธารณะ
app.use(express.static(path.join(__dirname, '..', 'public')));
// ✅ เปิดโฟลเดอร์ uploads ให้สามารถเข้าถึงรูปภาพผ่าน URL ได้
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

/* ================== ตั้งค่าการอัปโหลดรูป (Multer) ================== */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = './public/uploads/';
        if (!fs.existsSync(uploadPath)) {
            try {
                fs.mkdirSync(uploadPath, { recursive: true });
            } catch (e) {
                console.error("สร้างโฟลเดอร์ uploads ไม่ได้:", e);
            }
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^a-zA-Z0-9.]/g, "_");
        cb(null, Date.now() + "_" + safeName);
    }
});
const upload = multer({ storage: storage });

/* ================== API จัดการสินค้า (เพิ่มฟิลด์ sub_category) ================== */

// ✅ 1. เพิ่มสินค้าใหม่ พร้อมบันทึกหมวดหมู่ย่อย
app.post('/api/products', upload.single('imageFile'), async (req, res) => {
    const { product_name, price, stock, category_id, drink_options, sub_category } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const catRes = await pool.query('SELECT category_name FROM categories WHERE category_id = $1', [category_id]);
        const catName = catRes.rows[0]?.category_name || 'ทั่วไป';

        let prefix = 'PRO';
        if (catName === 'เครื่องดื่ม') prefix = 'DR';
        else if (catName === 'ขนมหวาน') prefix = 'DE';

        const lastProdRes = await pool.query(
            'SELECT product_code FROM products WHERE product_code LIKE $1 ORDER BY product_id DESC LIMIT 1',
            [prefix + '%']
        );

        let nextNum = 1;
        if (lastProdRes.rows.length > 0) {
            const lastCode = lastProdRes.rows[0].product_code;
            const lastNum = parseInt(lastCode.replace(prefix, ''));
            if (!isNaN(lastNum)) nextNum = lastNum + 1;
        }

        const product_code = `${prefix}${nextNum.toString().padStart(3, '0')}`;

        const result = await pool.query(
            'INSERT INTO products (product_code, product_name, price, stock, category_id, image, drink_options, sub_category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [product_code, product_name, price, stock, category_id, imagePath, drink_options, sub_category]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Insert Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ✅ 2. แก้ไขสินค้า พร้อมอัปเดตหมวดหมู่ย่อย
app.put('/api/products/:id', upload.single('imageFile'), async (req, res) => {
    const { id } = req.params;
    const { product_name, price, stock, category_id, drink_options, sub_category } = req.body;

    let query = 'UPDATE products SET product_name=$1, price=$2, stock=$3, category_id=$4, drink_options=$5, sub_category=$6';
    let params = [product_name, price, stock, category_id, drink_options, sub_category, id];

    if (req.file) {
        const imagePath = `/uploads/${req.file.filename}`;
        query += ', image=$7 WHERE product_id=$8';
        params = [product_name, price, stock, category_id, drink_options, sub_category, imagePath, id];
    } else {
        query += ' WHERE product_id=$7';
    }

    try {
        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE product_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================== API ระบบสมาชิกและพนักงาน ================== */

app.post('/api/users/staff', async (req, res) => {
    const { username, password, full_name, role, phone, email } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password, full_name, role, phone, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [username, password, full_name, role || 'staff', phone, email]
        );
        res.status(201).json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: "Error" }); }
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { full_name, phone, email, role } = req.body;
    try {
        await pool.query(
            'UPDATE users SET full_name=$1, phone=$2, email=$3, role=$4 WHERE user_id=$5',
            [full_name, phone, email, role, id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE user_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT user_id, username, full_name, role, phone, email FROM users WHERE role IN ('staff', 'owner') ORDER BY user_id DESC"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "ดึงข้อมูลผู้ใช้ล้มเหลว" });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT user_id, username, full_name, role, email FROM users WHERE (username = $1 OR email = $1) AND password = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
    }
});

/* ================== API สินค้าและหมวดหมู่ ================== */

app.get('/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY category_id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

app.get('/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, c.category_name FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            ORDER BY p.product_id DESC
        `); 
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

/* ================== API ออเดอร์และคิว ================== */

app.post('/orders', async (req, res) => {
    const { total_price, items, payment_method, user_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderRes = await client.query(
            'INSERT INTO orders (total_price, payment_method, user_id, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [total_price, payment_method || 'Cash', user_id, 'Pending']
        );
        const order = orderRes.rows[0];
        for (const item of items) {
            await client.query(
                'INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, $3, $4, $5)',
                [order.order_id, item.product_id, item.product_name, item.quantity, item.price]
            );
            await client.query('UPDATE products SET stock = stock - $1 WHERE product_id = $2', [item.quantity, item.product_id]);
        }
        await client.query('COMMIT');
        res.status(200).json({ success: true, order: order });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        console.error("Order Error:", err);
        res.status(500).json({ success: false }); 
    }
    finally { client.release(); }
});

app.get('/orders', async (req, res) => {
    const days = parseInt(req.query.days) || 0;
    try {
        let dateQuery = days === 0 ? "WHERE o.created_at >= CURRENT_DATE" : `WHERE o.created_at >= CURRENT_DATE - INTERVAL '${days} days'`;

        const result = await pool.query(`
            SELECT o.*, u.full_name as staff_name, 
            CASE 
                WHEN u.role = 'customer' THEN 'Online' 
                ELSE 'POS' 
            END as order_type,
            JSON_AGG(JSON_BUILD_OBJECT('product_name', oi.product_name, 'quantity', oi.quantity, 'price', oi.price)) AS items 
            FROM orders o 
            JOIN order_items oi ON o.order_id = oi.order_id 
            LEFT JOIN users u ON o.user_id = u.user_id
            ${dateQuery}
            GROUP BY o.order_id, u.full_name, u.role ORDER BY o.order_id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.put('/orders/:id', async (req, res) => {
    try {
        await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

/* ================== API ประวัติลูกค้า และ ล้างข้อมูล ================== */

app.get('/api/orders/customer/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, JSON_AGG(oi.*) as items 
            FROM orders o 
            JOIN order_items oi ON o.order_id = oi.order_id 
            WHERE o.user_id = $1 GROUP BY o.order_id ORDER BY o.order_id DESC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Error" }); }
});


app.delete('/api/clear-orders', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM order_items');
        await client.query('DELETE FROM orders');
        await client.query('COMMIT');
        res.json({ success: true, message: "ล้างข้อมูลสำเร็จ" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.post('/api/register', async (req, res) => {
    const { username, password, full_name, phone, email } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password, full_name, role, phone, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [username, password, full_name, 'customer', phone, email]
        );
        res.status(201).json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Username หรือ Email นี้ถูกใช้งานแล้ว" });
    }
    
});
/* ================== API Google Login (ปรับปรุงใหม่) ================== */
const client = new OAuth2Client('669190044603-jonumocatej1sdtcfkqmqnp383do3um8.apps.googleusercontent.com');

app.post('/api/google-login', async (req, res) => {
    const { token } = req.body;
    try {
        // 1. ตรวจสอบ Token กับ Google
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: '669190044603-jonumocatej1sdtcfkqmqnp383do3um8.apps.googleusercontent.com',
        });
        const payload = ticket.getPayload();
        const { email, name } = payload;

        // 2. เช็คในฐานข้อมูลว่ามีอีเมลนี้หรือยัง
        let userRes = await pool.query('SELECT user_id, username, full_name, role, email FROM users WHERE email = $1', [email]);
        
        let user;
        if (userRes.rows.length === 0) {
            // 3. ถ้ายังไม่มี ให้สมัครสมาชิกให้อัตโนมัติทันที
            const newUsername = email.split('@')[0] + "_" + Math.floor(Math.random() * 1000); // กันชื่อซ้ำ
            const newUserRes = await pool.query(
                'INSERT INTO users (username, password, full_name, role, email) VALUES ($1, $2, $3, $4, $5) RETURNING user_id, username, full_name, role, email',
                [newUsername, 'google_authenticated', name, 'customer', email]
            );
            user = newUserRes.rows[0];
            console.log("🆕 สร้างผู้ใช้ใหม่จาก Google:", email);
        } else {
            // 4. ถ้ามีแล้ว ให้ดึงข้อมูลมาล็อกอิน
            user = userRes.rows[0];
            console.log("✅ ผู้ใช้เดิมเข้าสู่ระบบด้วย Google:", email);
        }

        // ส่งข้อมูลผู้ใช้กลับไปให้หน้าบ้านเซฟลง localStorage
        res.json({ success: true, user: user });

    } catch (error) {
        console.error("Google verify error:", error);
        res.status(400).json({ success: false, message: 'การตรวจสอบข้อมูล Google ล้มเหลว' });
    }
});




// ✅ รันเซิร์ฟเวอร์พร้อมบอกสถานะ
app.listen(port, () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 Naii Baan Server ONLINE!`);
    console.log(`🔗 Listening at http://localhost:${port}`);
    console.log(`-------------------------------------------`);
});
