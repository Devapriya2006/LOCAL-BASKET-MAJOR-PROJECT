# LocalBasket

Hyperlocal farmer-to-customer marketplace.

## Structure
```
frontend/         static site (served by the backend, or open directly)
  index.html
  css/main.css
  js/api.js
  pages/           all other pages (login, products, dashboards, etc.)
backend/
  server.js
  fixdb.js         one-time script to fix a stale index / null orderNumber issue
  package.json
  .env.example     copy to .env and fill in your own values — never commit .env
  routes/
    auth.js
    products.js
    orders.js
    cart.js
    users.js
    admin.js
  models/
    User.js
    Product.js
    Order.js
  middleware/
    auth.js
  utils/
    notifications.js
```

## Setup
```bash
cd backend
npm install
cp .env.example .env   # then edit .env with your real values
npm run dev
```

## Still needed
- `frontend/css/responsive.css` — linked from `index.html`, not yet uploaded.
  Everything else needed to run the backend (routes, models, middleware, utils,
  server entry point) is now included.

## Security notes
- `.env` is git-ignored — only `.env.example` (placeholders, no real secrets) is committed.
- `admin-panel.html` and `db-viewer.html` call `/api/admin/...` endpoints. Confirmed: every
  route in `routes/admin.js` is gated with `protect, authorize('admin')`, and password/OTP
  fields are stripped before user documents are returned — good.
- `routes/auth.js` returns the OTP directly in the response (`devOTP`) but only when
  `NODE_ENV === 'development'` — just make sure `NODE_ENV=production` is actually set
  on your real deployment, or that dev-mode leak becomes a real one.
- `routes/users.js` `GET /:id` excludes `cart` but not `password` explicitly — confirmed safe:
  `models/User.js` has `password`, `resetOTP`, `resetOTPExpire`, and `resetOTPVerified` all set
  to `select: false`, so none of them come back unless a query explicitly asks for them.
- `models/User.js` also strips `password` in `toJSON()` as a second layer of defense, and hashes
  passwords with bcrypt (cost factor 12) before saving — all solid practice.
- **⚠️ `middleware/auth.js` has a hardcoded fallback JWT secret**: both `jwt.verify(...)` and
  `generateToken(...)` fall back to the literal string `'localbasket_secret'` if `process.env.JWT_SECRET`
  isn't set. That fallback string is now public in this repo. It's not a real leaked credential (it's
  a placeholder default, same idea as the `.env.example` note), but if you ever deploy without setting
  a real `JWT_SECRET` in your actual `.env`, anyone who reads this repo could forge valid login tokens.
  Just make sure `JWT_SECRET` is always set to a strong random value in your real `.env` — never rely
  on the fallback.
