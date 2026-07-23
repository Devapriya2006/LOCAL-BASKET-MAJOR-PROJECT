const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  farmer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name:     String,
  price:    Number,
  quantity: Number,
  unit:     String,
  image:    String
});

const orderSchema = new mongoose.Schema({
  // Human-readable order number (e.g. LB-20241201-0001)
  // Generated in pre-save hook — NOT a unique index issue
  orderNumber: {
    type: String
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  totalAmount: {
    type: Number,
    required: true
  },
  deliveryAddress: {
    name:    String,
    phone:   String,
    address: String,
    city:    String,
    state:   String,
    pincode: String
  },
  paymentMethod: {
    type:    String,
    enum:    ['COD', 'UPI', 'card'],
    default: 'COD'
  },
  paymentStatus: {
    type:    String,
    enum:    ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  status: {
    type:    String,
    enum:    ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed'
  },
  statusHistory: [{
    status:    String,
    timestamp: { type: Date, default: Date.now },
    note:      String
  }],
  deliveryDate:       Date,
  deliverySlot:       String,
  notes:              String,
  cancellationReason: String
}, {
  timestamps: true
});

// ── Generate a readable order number before saving ────────────────────────────
orderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    const date  = new Date();
    const yyyymmdd = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
    const count = await mongoose.model('Order').countDocuments();
    this.orderNumber = `LB-${yyyymmdd}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// ── Only add indexes that actually exist in the schema ────────────────────────
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ 'items.farmer': 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
