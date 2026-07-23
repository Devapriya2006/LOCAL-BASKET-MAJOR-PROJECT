const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// @route   GET /api/orders
// @desc    Get orders for current user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    let query;
    if (req.user.role === 'customer') {
      query = { customer: req.user._id };
    } else if (req.user.role === 'farmer') {
      query = { 'items.farmer': req.user._id };
    } else {
      query = {}; // admin sees all
    }

    const orders = await Order.find(query)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name images')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/orders/:id
// @desc    Get single order
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name images category')
      .populate('items.farmer', 'name farmName phone');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Authorization check
    const isCustomer = order.customer._id.toString() === req.user._id.toString();
    const isFarmer = order.items.some(i => i.farmer._id.toString() === req.user._id.toString());
    const isAdmin = req.user.role === 'admin';

    if (!isCustomer && !isFarmer && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   POST /api/orders
// @desc    Place an order
// @access  Private/Customer
router.post('/', protect, authorize('customer'), async (req, res) => {
  try {
    const { items, deliveryAddress, paymentMethod, deliveryDate, deliverySlot, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in order.' });
    }

    // Validate products and build order items
    const orderItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) return res.status(404).json({ success: false, message: `Product not found: ${item.product}` });
      if (!product.isAvailable) return res.status(400).json({ success: false, message: `${product.name} is no longer available.` });
      if (product.quantity < item.quantity) {
        return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}. Available: ${product.quantity}` });
      }

      orderItems.push({
        product: product._id,
        farmer: product.farmer,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        unit: product.unit,
        image: product.images[0] || null
      });

      totalAmount += product.price * item.quantity;

      // Deduct stock
      product.quantity -= item.quantity;
      product.totalSold += item.quantity;
      if (product.quantity === 0) product.isAvailable = false;
      await product.save();
    }

    const order = await Order.create({
      customer: req.user._id,
      items: orderItems,
      totalAmount: Math.round(totalAmount * 100) / 100,
      deliveryAddress,
      paymentMethod: paymentMethod || 'COD',
      deliveryDate,
      deliverySlot,
      notes,
      statusHistory: [{ status: 'placed', note: 'Order placed successfully' }]
    });

    // Clear cart
    await User.findByIdAndUpdate(req.user._id, { $set: { cart: [] } });

    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'items.product', select: 'name images' }
    ]);

    res.status(201).json({ success: true, message: 'Order placed successfully!', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order status (farmer/admin)
// @access  Private/Farmer or Admin
router.put('/:id/status', protect, authorize('farmer', 'admin'), async (req, res) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    order.status = status;
    order.statusHistory.push({ status, note: note || '' });
    if (status === 'delivered') order.paymentStatus = 'paid';
    await order.save();

    res.json({ success: true, message: 'Order status updated!', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   PUT /api/orders/:id/cancel
// @desc    Cancel an order (customer)
// @access  Private/Customer
router.put('/:id/cancel', protect, authorize('customer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (order.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (['delivered', 'out_for_delivery'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel order at this stage.' });
    }

    order.status = 'cancelled';
    order.cancellationReason = req.body.reason;
    order.statusHistory.push({ status: 'cancelled', note: req.body.reason || 'Cancelled by customer' });

    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { quantity: item.quantity, totalSold: -item.quantity },
        isAvailable: true
      });
    }

    await order.save();
    res.json({ success: true, message: 'Order cancelled.', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/orders/farmer/stats
// @desc    Get farmer order stats
// @access  Private/Farmer
router.get('/farmer/stats', protect, authorize('farmer'), async (req, res) => {
  try {
    const allOrders = await Order.find({ 'items.farmer': req.user._id });
    const stats = {
      total: allOrders.length,
      placed: allOrders.filter(o => o.status === 'placed').length,
      confirmed: allOrders.filter(o => o.status === 'confirmed').length,
      preparing: allOrders.filter(o => o.status === 'preparing').length,
      delivered: allOrders.filter(o => o.status === 'delivered').length,
      cancelled: allOrders.filter(o => o.status === 'cancelled').length,
      revenue: allOrders
        .filter(o => o.status === 'delivered')
        .reduce((acc, o) => {
          const farmerItems = o.items.filter(i => i.farmer.toString() === req.user._id.toString());
          return acc + farmerItems.reduce((s, i) => s + i.price * i.quantity, 0);
        }, 0)
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
