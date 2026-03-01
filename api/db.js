const { Pool } = require("pg");

const isProduction = process.env.DATABASE_URL;

const config = isProduction
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME
    };

const pool = new Pool(config);

/* ===== ตรวจสอบการเชื่อมต่อ DB ตอน start server ===== */
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected");
    release();
  }
});

/* ===== กัน crash ถ้า DB หลุด ===== */
pool.on("error", (err) => {
  console.error("❌ Unexpected DB error", err);
  process.exit(-1);
});

module.exports = pool;