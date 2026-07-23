const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const os = require('os');
require('dotenv').config();

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ─── Serve Uploaded Files ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Serve Frontend (so localhost:5000 opens the website directly) ────────────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/cart',     require('./routes/cart'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/admin',    require('./routes/admin'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: '🌱 LocalBasket API is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    frontend: `http://localhost:${process.env.PORT || 5000}`,
    api: `http://localhost:${process.env.PORT || 5000}/api`
  });
});

// ─── Frontend Fallback ────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  } else {
    res.status(404).json({ success: false, message: `API route ${req.originalUrl} not found` });
  }
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ─── Get Local Network IP ─────────────────────────────────────────────────────
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
};

// ─── Auto-fix Stale Indexes on Startup ───────────────────────────────────────
// Drops any stale unique indexes left over from previous schema versions.
// This is what causes the "E11000 duplicate key orderId_1" error.
const fixStaleIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    const staleIndexNames = ['orderId_1', 'orderNumber_1'];

    for (const indexName of staleIndexNames) {
      try {
        await db.collection('orders').dropIndex(indexName);
        console.log(`  🔧 Dropped stale index "${indexName}" from orders collection`);
      } catch (e) {
        // Index didn't exist — that's fine, move on
      }
    }
  } catch (e) {
    // Collection may not exist yet — that's fine
  }
};

// ─── Connect DB & Start Server ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/localbasket'
    );
    console.log(`\n  ✅ MongoDB Connected: ${conn.connection.host}`);

    // Auto-fix any stale indexes every time the server starts
    await fixStaleIndexes();

  } catch (err) {
    console.error('\n  ❌ MongoDB connection error:', err.message);
    console.error('  💡 Make sure MongoDB is running.');
    console.error('     Windows: net start MongoDB');
    console.error('     Mac:     brew services start mongodb-community');
    console.error('     Linux:   sudo systemctl start mongod\n');
    process.exit(1);
  }
};

connectDB().then(() => {
  app.listen(PORT, () => {
    const localIP = getLocalIP();

    console.log('\n');
    console.log('  🧺 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('     LocalBasket — Running!');
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  🌐 OPEN YOUR APP HERE:`);
    console.log(`     ➜  http://localhost:${PORT}`);
    console.log(`     ➜  http://${localIP}:${PORT}   (other devices on your network)`);
    console.log('');
    console.log(`  🔌 API Base: http://localhost:${PORT}/api`);
    console.log(`  🩺 Health:   http://localhost:${PORT}/api/health`);
    console.log('');
    console.log('  🌱 Ready! Open http://localhost:5000 in your browser.');
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
});

module.exports = app;
