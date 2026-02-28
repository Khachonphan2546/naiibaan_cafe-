const { Pool } = require('pg');
require('dotenv').config();

// เช็คว่าถ้าอยู่บน Render จะมี DATABASE_URL มาให้
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;

const pool = new Pool({
  // ถ้ามี DATABASE_URL (บน Cloud) ให้ใช้ตัวนั้นเลย ถ้าไม่มี (ในเครื่อง) ให้ใช้ค่าแยกๆ แบบเดิม
  connectionString: process.env.DATABASE_URL,
  
  // กรณีรันในเครื่อง (Local) ที่ไม่มี DATABASE_URL ให้ใช้ค่าพวกนี้แทน
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,

  // ✅ จุดสำคัญ: ถ้าอยู่บน Render ต้องเปิด SSL ไม่งั้นจะเชื่อมต่อไม่ได้
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// เช็คสถานะการเชื่อมต่อ
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ เชื่อมต่อ Database ไม่สำเร็จ:', err.stack);
  }
  console.log('✅ เชื่อมต่อ Database สำเร็จแล้ว!');
  release(); // คืนการเชื่อมต่อเข้า Pool
});

module.exports = pool;