// ─── LocalBasket OTP & Notification Service ──────────────────────────────────
const nodemailer = require('nodemailer');

// ─── Email Transporter ────────────────────────────────────────────────────────
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false }
  });
};

// ─── Send OTP Email ───────────────────────────────────────────────────────────
const sendOTPEmail = async (email, otp, name = 'User') => {
  // If email not configured, log to console (dev mode)
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_gmail@gmail.com') {
    console.log(`\n📧 [DEV MODE] OTP Email to ${email}`);
    console.log(`   Name: ${name}`);
    console.log(`   OTP: ${otp}`);
    console.log(`   Expires in: ${process.env.OTP_EXPIRE_MINUTES || 10} minutes\n`);
    return { success: true, dev: true };
  }

  try {
    const transporter = createTransporter();
    const expireMin = process.env.OTP_EXPIRE_MINUTES || 10;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"LocalBasket 🧺" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🔐 Your LocalBasket Password Reset OTP`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f0e8; margin: 0; padding: 20px; }
            .card { background: white; max-width: 480px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(44,26,14,.12); }
            .header { background: #2C1A0E; padding: 28px 32px; text-align: center; }
            .logo { color: #F0D080; font-size: 22px; font-weight: bold; }
            .body { padding: 32px; }
            .otp-box { background: #F4F0E8; border: 2px dashed #D4A853; border-radius: 12px; text-align: center; padding: 24px; margin: 24px 0; }
            .otp-code { font-size: 40px; font-weight: 900; letter-spacing: 12px; color: #2D6A2D; font-family: monospace; }
            .note { font-size: 13px; color: #9E9086; margin-top: 8px; }
            .footer { background: #F4F0E8; padding: 16px 32px; font-size: 12px; color: #9E9086; text-align: center; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <div class="logo">🧺 LocalBasket</div>
              <p style="color:#DDD8CF;font-size:13px;margin:6px 0 0">Hyperlocal Farmer's Market Portal</p>
            </div>
            <div class="body">
              <h2 style="color:#2C1A0E;margin:0 0 8px">Hello, ${name}! 👋</h2>
              <p style="color:#5C3A1E;line-height:1.6">
                You requested a password reset for your LocalBasket account.
                Use the OTP code below to proceed:
              </p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <div class="note">⏰ This OTP expires in <strong>${expireMin} minutes</strong></div>
              </div>
              <p style="color:#6B5F54;font-size:13px;line-height:1.6">
                If you did not request a password reset, please ignore this email. 
                Your account is safe and no changes have been made.
              </p>
              <p style="color:#6B5F54;font-size:13px;">Do not share this OTP with anyone.</p>
            </div>
            <div class="footer">
              © ${new Date().getFullYear()} LocalBasket · Fresh from the Farm
            </div>
          </div>
        </body>
        </html>
      `
    });

    return { success: true };
  } catch (err) {
    console.error('❌ Email send error:', err.message);
    throw new Error('Failed to send OTP email. Please try again.');
  }
};

// ─── Send OTP SMS (Twilio) ────────────────────────────────────────────────────
const sendOTPSMS = async (phone, otp) => {
  const expireMin = process.env.OTP_EXPIRE_MINUTES || 10;

  // If Twilio not configured, log to console (dev mode)
  if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID.startsWith('ACxxx')) {
    console.log(`\n📱 [DEV MODE] OTP SMS to ${phone}`);
    console.log(`   OTP: ${otp}`);
    console.log(`   Expires in: ${expireMin} minutes\n`);
    return { success: true, dev: true };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    await client.messages.create({
      body: `🧺 LocalBasket: Your OTP is ${otp}. Valid for ${expireMin} minutes. Do not share with anyone.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone.startsWith('+') ? phone : `+91${phone}` // Default India +91
    });

    return { success: true };
  } catch (err) {
    console.error('❌ SMS send error:', err.message);
    throw new Error('Failed to send OTP SMS. Please try again.');
  }
};

// ─── Order Status Email ───────────────────────────────────────────────────────
const sendOrderStatusEmail = async (email, name, orderId, status, details = '') => {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_gmail@gmail.com') {
    console.log(`\n📧 [DEV MODE] Order Status Email → ${email}: Order #${orderId} is now ${status}`);
    return { success: true, dev: true };
  }

  const statusMessages = {
    confirmed: { emoji: '✅', title: 'Order Confirmed!', msg: 'Your farmer has confirmed your order and will start preparing it soon.' },
    preparing: { emoji: '👨‍🌾', title: 'Order Being Prepared', msg: 'Your farmer is carefully packing your fresh produce.' },
    out_for_delivery: { emoji: '🚚', title: 'Out for Delivery!', msg: 'Your order is on the way. Get ready for fresh produce at your door!' },
    delivered: { emoji: '🎉', title: 'Order Delivered!', msg: 'Your fresh produce has been delivered. Enjoy your meal!' },
    cancelled: { emoji: '❌', title: 'Order Cancelled', msg: details || 'Your order has been cancelled.' }
  };

  const info = statusMessages[status] || { emoji: '📦', title: `Order ${status}`, msg: details };

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `${info.emoji} ${info.title} – Order #${orderId.slice(-8).toUpperCase()}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f4f0e8;padding:20px;border-radius:12px">
          <div style="background:#2C1A0E;padding:20px;border-radius:8px;text-align:center;margin-bottom:16px">
            <div style="color:#F0D080;font-size:18px;font-weight:bold">🧺 LocalBasket</div>
          </div>
          <div style="background:white;padding:24px;border-radius:8px">
            <h2 style="color:#2C1A0E">${info.emoji} ${info.title}</h2>
            <p style="color:#5C3A1E">Hi ${name},</p>
            <p style="color:#5C3A1E">${info.msg}</p>
            <div style="background:#f4f0e8;padding:12px;border-radius:8px;margin:16px 0">
              <strong>Order ID:</strong> #${orderId.slice(-8).toUpperCase()}
            </div>
            <a href="#" style="background:#2D6A2D;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">
              Track Order
            </a>
          </div>
        </div>
      `
    });
    return { success: true };
  } catch (err) {
    console.error('Order status email error:', err.message);
    return { success: false };
  }
};

module.exports = { sendOTPEmail, sendOTPSMS, sendOrderStatusEmail };
