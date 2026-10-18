// Creates (or resets the password of) the administrator account.
// Usage: set ADMIN_EMAIL, ADMIN_PASSWORD (and optionally ADMIN_NAME) in .env, then
//   npm run seed:admin
import bcrypt from 'bcryptjs';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { email as emailSchema, password as passwordSchema } from '../src/utils/validators.js';

const email = emailSchema.safeParse(process.env.ADMIN_EMAIL ?? '');
const password = passwordSchema.safeParse(process.env.ADMIN_PASSWORD ?? '');
if (!email.success || !password.success) {
  console.error('Set a valid ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars, letters and numbers).');
  process.exit(1);
}

await connectDatabase(config.MONGODB_URI);
const passwordHash = await bcrypt.hash(password.data, config.BCRYPT_ROUNDS);
const existing = await User.findOne({ email: email.data });
if (existing && existing.role !== 'admin') {
  console.error('A non-admin account already uses this email. Choose a different ADMIN_EMAIL.');
  await disconnectDatabase();
  process.exit(1);
}
await User.findOneAndUpdate(
  { email: email.data },
  {
    $set: { name: process.env.ADMIN_NAME || 'MindChain Administrator', passwordHash, role: 'admin', accountStatus: 'active' },
    $inc: { tokenVersion: 1 },
  },
  { upsert: true, setDefaultsOnInsert: true },
);
console.log(`Administrator account ready: ${email.data}`);
await disconnectDatabase();
