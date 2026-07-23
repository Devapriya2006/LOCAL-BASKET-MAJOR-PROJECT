const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');
const { sendOTPEmail, sendOTPSMS } = require('../utils/notifications');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

/** Generate a 6-digit numeric OTP */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
// POST /api/auth/register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['customer', 'farmer']).withMessage('Role must be customer or farmer')
], handleValidationErrors, async (req, res) => {
  try {
    const { name, email, password, role, phone, location, farmName, farmDescription } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered. Please login.' });
    }

    const userData = { name, email, password, role, phone };
    if (location) userData.location = location;
    if (role === 'farmer') {
      userData.farmName = farmName;
      userData.farmDescription = farmDescription;
    }

    const user = await User.create(userData);
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome to LocalBasket 🌱',
      token,
      user
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated. Contact support.' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: `Welcome back, ${user.name.split(' ')[0]}! 👋`,
      token,
      user
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'cart.product',
      populate: { path: 'farmer', select: 'name farmName location' }
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── UPDATE PROFILE ───────────────────────────────────────────────────────────
// PUT /api/auth/profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone, location, farmName, farmDescription } = req.body;
    const update = {};
    if (name) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (location) update.location = location;
    if (farmName !== undefined) update.farmName = farmName;
    if (farmDescription !== undefined) update.farmDescription = farmDescription;

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
    res.json({ success: true, message: 'Profile updated!', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
// PUT /api/auth/change-password
router.put('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], handleValidationErrors, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD – STEP 1: REQUEST OTP
// POST /api/auth/forgot-password
// Sends a 6-digit OTP to the user's registered email AND mobile number
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email required')
], handleValidationErrors, async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+resetOTP +resetOTPExpire +resetOTPVerified'
    );

    if (!user) {
      // Security: don't reveal if email exists
      return res.json({
        success: true,
        message: 'If this email is registered, an OTP has been sent to your email and mobile number.'
      });
    }

    // Rate limit: prevent OTP spam (1 request per 60 seconds)
    if (user.resetOTPExpire && user.resetOTPExpire > Date.now() + (parseInt(process.env.OTP_EXPIRE_MINUTES || 10) - 1) * 60 * 1000) {
      return res.status(429).json({
        success: false,
        message: 'OTP already sent. Please wait 60 seconds before requesting again.'
      });
    }

    const otp = generateOTP();
    const expireMs = parseInt(process.env.OTP_EXPIRE_MINUTES || 10) * 60 * 1000;

    // Store hashed OTP (security: never store plain OTP in DB)
    user.resetOTP = crypto.createHash('sha256').update(otp).digest('hex');
    user.resetOTPExpire = new Date(Date.now() + expireMs);
    user.resetOTPVerified = false;
    await user.save({ validateBeforeSave: false });

    // Send OTP via EMAIL
    const emailResult = await sendOTPEmail(user.email, otp, user.name).catch(err => {
      console.error('Email OTP error:', err.message);
      return { success: false };
    });

    // Send OTP via SMS (if phone exists)
    let smsResult = { success: false, skipped: true };
    if (user.phone) {
      smsResult = await sendOTPSMS(user.phone, otp).catch(err => {
        console.error('SMS OTP error:', err.message);
        return { success: false };
      });
    }

    // In DEV mode, include the OTP in response for easy testing
    const isDev = process.env.NODE_ENV === 'development';
    const maskedEmail = user.email.replace(/(.{2})(.+)(@.+)/, '$1****$3');
    const maskedPhone = user.phone ? user.phone.replace(/(\d{2})(\d+)(\d{2})/, '$1******$3') : null;

    res.json({
      success: true,
      message: `OTP sent to ${maskedEmail}${maskedPhone ? ' and ' + maskedPhone : ''}. Valid for ${process.env.OTP_EXPIRE_MINUTES || 10} minutes.`,
      sentTo: {
        email: maskedEmail,
        phone: maskedPhone,
        emailDelivered: emailResult.success,
        smsDelivered: smsResult.success
      },
      ...(isDev && { devOTP: otp, devNote: '⚠️ OTP shown only in development mode' })
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP. ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD – STEP 2: VERIFY OTP
// POST /api/auth/verify-otp
// Verifies the 6-digit OTP entered by the user
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/verify-otp', [
  body('email').isEmail().withMessage('Valid email required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric().withMessage('OTP must be numeric')
], handleValidationErrors, async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+resetOTP +resetOTPExpire +resetOTPVerified'
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request.' });
    }

    // Check OTP exists and not expired
    if (!user.resetOTP || !user.resetOTPExpire) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (user.resetOTPExpire < Date.now()) {
      // Clear expired OTP
      user.resetOTP = undefined;
      user.resetOTPExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // Compare hashed OTP
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    if (user.resetOTP !== hashedOTP) {
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please check and try again.' });
    }

    // Mark OTP as verified (allow password reset for next 15 min)
    user.resetOTPVerified = true;
    user.resetOTPExpire = new Date(Date.now() + 15 * 60 * 1000); // 15 min window to reset
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'OTP verified successfully! You can now reset your password.',
      email: user.email
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD – STEP 3: RESET PASSWORD
// POST /api/auth/reset-password
// Sets a new password after OTP has been verified
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/reset-password', [
  body('email').isEmail().withMessage('Valid email required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirmPassword').custom((val, { req }) => {
    if (val !== req.body.newPassword) throw new Error('Passwords do not match');
    return true;
  })
], handleValidationErrors, async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+resetOTP +resetOTPExpire +resetOTPVerified +password'
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request.' });
    }

    // Must have verified OTP first
    if (!user.resetOTPVerified) {
      return res.status(400).json({ success: false, message: 'Please verify your OTP first.' });
    }

    // Check verification window hasn't expired
    if (user.resetOTPExpire < Date.now()) {
      user.resetOTP = undefined;
      user.resetOTPExpire = undefined;
      user.resetOTPVerified = false;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ success: false, message: 'Session expired. Please start over.' });
    }

    // Update password & clear OTP fields
    user.password = newPassword;
    user.resetOTP = undefined;
    user.resetOTPExpire = undefined;
    user.resetOTPVerified = false;
    await user.save();

    // Auto-login: return new token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Password reset successfully! You are now logged in.',
      token,
      user
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── RESEND OTP ───────────────────────────────────────────────────────────────
// POST /api/auth/resend-otp
router.post('/resend-otp', [
  body('email').isEmail().withMessage('Valid email required')
], handleValidationErrors, async (req, res) => {
  // Just re-use the forgot-password logic
  req.url = '/forgot-password';
  router.handle(req, res);
});

module.exports = router;
