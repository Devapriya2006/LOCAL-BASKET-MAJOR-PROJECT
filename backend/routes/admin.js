const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { protect, authorize } = require('../middleware/auth');

// ─── DB Health & Stats ─────────────────────────────────────────────────────────
// GET /api/admin/db-stats
router.get('/db-stats', protect, authorize('admin'), async (req, res) => {
  try {
    const [
      totalUsers, farmers, customers,
      totalProducts, availableProducts,
      totalOrders, pendingOrders, deliveredOrders,
      dbStats
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'farmer' }),
      User.countDocuments({ role: 'customer' }),
      Product.countDocuments(),
      Product.countDocuments({ isAvailable: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: ['placed', 'confirmed', 'preparing'] } }),
      Order.countDocuments({ status: 'delivered' }),
      mongoose.connection.db.stats()
    ]);

    const revenue = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.json({
      success: true,
      database: {
        name: mongoose.connection.db.databaseName,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        state: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
        collections: dbStats.collections,
        dataSize: (dbStats.dataSize / 1024).toFixed(2) + ' KB',
        storageSize: (dbStats.storageSize / 1024).toFixed(2) + ' KB',
        indexes: dbStats.indexes,
        avgObjSize: dbStats.avgObjSize ? dbStats.avgObjSize.toFixed(0) + ' bytes' : 'N/A'
      },
      collections: {
        users: { total: totalUsers, farmers, customers },
        products: { total: totalProducts, available: availableProducts, unavailable: totalProducts - availableProducts },
        orders: { total: totalOrders, pending: pendingOrders, delivered: deliveredOrders, cancelled: totalOrders - pendingOrders - deliveredOrders }
      },
      revenue: revenue[0]?.total?.toFixed(2) || '0.00'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Browse Collection ────────────────────────────────────────────────────────
// GET /api/admin/collection/:name?page=1&limit=20&search=
router.get('/collection/:name', protect, authorize('admin'), async (req, res) => {
  try {
    const { name } = req.params;
    const { page = 1, limit = 20, search = '', filter = '{}' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const models = { users: User, products: Product, orders: Order };
    const Model = models[name];
    if (!Model) return res.status(400).json({ success: false, message: `Collection '${name}' not found. Available: users, products, orders` });

    let query = {};
    try { query = JSON.parse(filter); } catch (e) {}

    // Search
    if (search) {
      if (name === 'users') query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
      if (name === 'products') query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Model.countDocuments(query);
    let docs = await Model.find(query).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }).lean();

    // Remove sensitive fields
    if (name === 'users') docs = docs.map(d => { delete d.password; delete d.resetOTP; delete d.resetOTPExpire; return d; });

    res.json({
      success: true,
      collection: name,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      count: docs.length,
      documents: docs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get Single Document ──────────────────────────────────────────────────────
router.get('/collection/:name/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const models = { users: User, products: Product, orders: Order };
    const Model = models[req.params.name];
    if (!Model) return res.status(400).json({ success: false, message: 'Invalid collection' });

    const doc = await Model.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    if (req.params.name === 'users') { delete doc.password; delete doc.resetOTP; delete doc.resetOTPExpire; }

    res.json({ success: true, document: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Delete Document ──────────────────────────────────────────────────────────
router.delete('/collection/:name/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const models = { users: User, products: Product, orders: Order };
    const Model = models[req.params.name];
    if (!Model) return res.status(400).json({ success: false, message: 'Invalid collection' });

    await Model.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Document deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get All Collection Names + Counts ────────────────────────────────────────
router.get('/collections', protect, authorize('admin'), async (req, res) => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const counts = await Promise.all(
      collections.map(async c => ({
        name: c.name,
        count: await mongoose.connection.db.collection(c.name).countDocuments()
      }))
    );
    res.json({ success: true, collections: counts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
