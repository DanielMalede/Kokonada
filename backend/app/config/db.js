const mongoose = require('mongoose');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

// Startup DB-name guard (T3.4). A production process that connected to the implicit 'test'
// database with NO MONGO_DB_NAME set is almost always a MONGO_URI missing its /dbname path —
// fail LOUD rather than silently persisting health data to the wrong place. When MONGO_DB_NAME
// IS set, the actual connection MUST match it (single safety property below) — that also lets an
// operator explicitly opt in to 'test' as the intended name. This does NOT rename anything.
function assertDbName(connectedName) {
  const expected = process.env.MONGO_DB_NAME;
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && connectedName === 'test' && !expected) {
    throw new Error(
      "Refusing to run in production against the default 'test' database — "
      + 'set the database name in MONGO_URI (and MONGO_DB_NAME to assert it)',
    );
  }
  if (expected && connectedName !== expected) {
    throw new Error(
      `Connected DB name "${connectedName}" does not match expected MONGO_DB_NAME "${expected}"`,
    );
  }
}

async function connectDB() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      break; // connected — the name check below is NOT retryable (config error, not transient)
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  assertDbName(mongoose.connection.name);
  console.log(`MongoDB connected [db=${mongoose.connection.name}]`);
}

mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));

module.exports = connectDB;
module.exports.assertDbName = assertDbName;