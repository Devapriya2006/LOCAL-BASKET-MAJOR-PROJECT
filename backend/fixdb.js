/**
 * LocalBasket – Database Fix Script
 * Run this ONCE to fix the "E11000 duplicate key orderId_1" error.
 *
 * Usage:
 *   cd backend
 *   node fixdb.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/localbasket';

async function fixDatabase() {
  console.log('\n🔧 LocalBasket Database Fix Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected to: ${MONGO_URI}\n`);

    const db = mongoose.connection.db;

    // ── 1. Drop the stale orderId_1 unique index ──────────────────────────────
    console.log('🔍 Checking for stale indexes on orders collection...');
    try {
      const indexes = await db.collection('orders').indexes();
      console.log('   Found indexes:', indexes.map(i => i.name).join(', '));

      const staleIndexes = indexes.filter(i =>
        i.name === 'orderId_1' ||
        i.name === 'orderNumber_1' ||
        (i.key && i.key.orderId !== undefined)
      );

      if (staleIndexes.length > 0) {
        for (const idx of staleIndexes) {
          await db.collection('orders').dropIndex(idx.name);
          console.log(`   ✅ Dropped stale index: "${idx.name}"`);
        }
      } else {
        console.log('   ✅ No stale orderId indexes found.');
      }
    } catch (e) {
      if (e.message.includes('ns not found') || e.message.includes('collection does not exist')) {
        console.log('   ℹ️  orders collection does not exist yet — nothing to fix.');
      } else {
        console.log('   ⚠️  Index check error:', e.message);
      }
    }

    // ── 2. Drop the stale orderId_1 index on ALL collections (safety net) ────
    const collections = ['orders', 'users', 'products'];
    for (const colName of collections) {
      try {
        const indexes = await db.collection(colName).indexes();
        for (const idx of indexes) {
          if (idx.name === 'orderId_1') {
            await db.collection(colName).dropIndex('orderId_1');
            console.log(`✅ Dropped orderId_1 from ${colName}`);
          }
        }
      } catch (e) { /* collection may not exist */ }
    }

    // ── 3. Fix null orderNumber fields in existing orders ─────────────────────
    console.log('\n🔍 Fixing existing orders with null orderNumber...');
    try {
      const orders = await db.collection('orders').find({ orderNumber: { $in: [null, undefined, ''] } }).toArray();

      if (orders.length > 0) {
        console.log(`   Found ${orders.length} orders without orderNumber. Fixing...`);
        for (let i = 0; i < orders.length; i++) {
          const order = orders[i];
          const date = new Date(order.createdAt || Date.now());
          const yyyymmdd = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
          const orderNumber = `LB-${yyyymmdd}-${String(i + 1).padStart(4, '0')}`;
          await db.collection('orders').updateOne(
            { _id: order._id },
            { $set: { orderNumber } }
          );
        }
        console.log(`   ✅ Fixed ${orders.length} orders.`);
      } else {
        console.log('   ✅ All orders already have orderNumber.');
      }
    } catch (e) {
      console.log('   ℹ️  No existing orders to fix.');
    }

    // ── 4. Recreate correct indexes ───────────────────────────────────────────
    console.log('\n🔍 Recreating correct indexes...');
    try {
      await db.collection('orders').createIndex({ customer: 1, createdAt: -1 });
      await db.collection('orders').createIndex({ 'items.farmer': 1, status: 1 });
      console.log('   ✅ Orders indexes recreated correctly.');
    } catch (e) {
      console.log('   ⚠️  Index creation note:', e.message);
    }

    // ── 5. Summary ────────────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Database fix complete!');
    console.log('\nNow run:  npm run dev');
    console.log('Then try placing an order again.\n');

  } catch (err) {
    console.error('\n❌ Fix failed:', err.message);
    console.error('\nMake sure MongoDB is running and try again.');
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

fixDatabase();
