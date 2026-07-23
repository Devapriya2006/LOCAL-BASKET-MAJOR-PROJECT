const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Product = require('../models/Product');
const { protect, authorize } = require('../middleware/auth');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

// @route   GET /api/products
// @desc    Get all products (with filters)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { category, city, pincode, search, sort, organic, page = 1, limit = 12, farmer } = req.query;
    const query = { isAvailable: true, quantity: { $gt: 0 } };

    if (category) query.category = category;
    if (city) query['location.city'] = new RegExp(city, 'i');
    if (pincode) query['location.pincode'] = pincode;
    if (organic === 'true') query.isOrganic = true;
    if (farmer) query.farmer = farmer;
    if (search) query.$text = { $search: search };

    let sortObj = { createdAt: -1 };
    if (sort === 'price_asc') sortObj = { price: 1 };
    if (sort === 'price_desc') sortObj = { price: -1 };
    if (sort === 'rating') sortObj = { averageRating: -1 };
    if (sort === 'popular') sortObj = { totalSold: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Product.countDocuments(query);
    const products = await Product.find(query)
      .populate('farmer', 'name farmName location avatar')
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: products.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      products
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/products/:id
// @desc    Get single product
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('farmer', 'name farmName location phone avatar farmDescription')
      .populate('ratings.user', 'name avatar');

    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   POST /api/products
// @desc    Create product (farmer only)
// @access  Private/Farmer
router.post('/', protect, authorize('farmer', 'admin'), [
  body('name').trim().notEmpty().withMessage('Product name required'),
  body('price').isNumeric().withMessage('Valid price required'),
  body('quantity').isNumeric().withMessage('Valid quantity required'),
  body('category').notEmpty().withMessage('Category required'),
  body('unit').notEmpty().withMessage('Unit required')
], handleValidationErrors, async (req, res) => {
  try {
    const productData = { ...req.body, farmer: req.user._id };
    // Use farmer's location if not provided
    if (!productData.location || !productData.location.city) {
      productData.location = req.user.location;
    }
    const product = await Product.create(productData);
    await product.populate('farmer', 'name farmName location');
    res.status(201).json({ success: true, message: 'Product listed successfully!', product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   PUT /api/products/:id
// @desc    Update product
// @access  Private/Farmer (own products)
router.put('/:id', protect, authorize('farmer', 'admin'), async (req, res) => {
  try {
    let product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    if (product.farmer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to update this product.' });
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true
    }).populate('farmer', 'name farmName location');

    res.json({ success: true, message: 'Product updated!', product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   DELETE /api/products/:id
// @desc    Delete product
// @access  Private/Farmer (own products)
router.delete('/:id', protect, authorize('farmer', 'admin'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    if (product.farmer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this product.' });
    }

    await product.deleteOne();
    res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   POST /api/products/:id/review
// @desc    Add review to product
// @access  Private/Customer
router.post('/:id/review', protect, authorize('customer'), async (req, res) => {
  try {
    const { rating, review } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    const alreadyReviewed = product.ratings.find(r => r.user.toString() === req.user._id.toString());
    if (alreadyReviewed) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this product.' });
    }

    product.ratings.push({ user: req.user._id, rating, review });
    product.calcAverageRating();
    await product.save();

    res.json({ success: true, message: 'Review added!', averageRating: product.averageRating });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route   GET /api/products/farmer/stats
// @desc    Get farmer's product stats
// @access  Private/Farmer
router.get('/farmer/stats', protect, authorize('farmer'), async (req, res) => {
  try {
    const products = await Product.find({ farmer: req.user._id });
    const stats = {
      totalProducts: products.length,
      availableProducts: products.filter(p => p.isAvailable).length,
      totalCategories: [...new Set(products.map(p => p.category))].length,
      averageRating: products.reduce((acc, p) => acc + p.averageRating, 0) / (products.length || 1),
      totalSold: products.reduce((acc, p) => acc + p.totalSold, 0)
    };
    res.json({ success: true, stats, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
