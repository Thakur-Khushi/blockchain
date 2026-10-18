// Must be imported before any src/ module so the config sees these values.
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.BCRYPT_ROUNDS = '4';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
// Each test file gets its own throw-away database on the local MongoDB server.
const base = process.env.TEST_MONGODB_URL ?? 'mongodb://127.0.0.1:27017';
process.env.MONGODB_URI = `${base}/mindchain_test_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY_VERSION = '2';
// A retired key so key-rotation decryption can be tested.
process.env.TEST_OLD_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_PREVIOUS_KEYS = `1:${process.env.TEST_OLD_KEY}`;
