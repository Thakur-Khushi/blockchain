// Creates non-sensitive demo data for local development:
//   - a verified demo therapist
//   - a demo patient with ~60 days of synthetic check-ins (encrypted like real ones)
// Usage: npm run seed:demo        (set DEMO_PASSWORD to choose the password)
// The records are not anchored on-chain: link a wallet in the app and anchor them
// from the Record integrity page.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { WellnessRecord } from '../src/models/WellnessRecord.js';
import { newRecordId } from '../src/services/recordDigest.js';
import { sealRecord } from '../src/services/wellnessRecordService.js';
import { password as passwordSchema } from '../src/utils/validators.js';

if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD || `Demo-${crypto.randomBytes(5).toString('hex')}1`;
if (!passwordSchema.safeParse(password).success) {
  console.error('DEMO_PASSWORD must be at least 8 characters with letters and numbers.');
  process.exit(1);
}

const DEMO = {
  therapist: { name: 'Dr Demo Therapist', email: 'demo.therapist@mindchain.local' },
  patient: { name: 'Demo Patient', email: 'demo.patient@mindchain.local' },
};
const JOURNAL_SNIPPETS = [
  'Slept well and went for a short walk.',
  'Busy day at work, felt a bit stretched.',
  'Caught up with a friend over coffee.',
  'Tired today, kept things simple.',
  'Tried a breathing exercise before bed.',
  'Good focus in the morning, slower afternoon.',
  '',
];
const TAGS = [['sleep'], ['work'], ['friends'], ['exercise'], ['work', 'sleep'], []];

await connectDatabase(config.MONGODB_URI);
const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

async function upsertUser({ name, email }, extra) {
  const existing = await User.findOne({ email });
  if (existing) return { user: existing, created: false };
  const user = await User.create({ name, email, passwordHash, ...extra });
  return { user, created: true };
}

const t = await upsertUser(DEMO.therapist, {
  role: 'therapist',
  verificationStatus: 'verified',
  verifiedAt: new Date(),
  therapistProfile: {
    licenseNumber: 'DEMO-0001',
    licensingBody: 'Demo Licensing Board',
    specialization: 'Stress and anxiety (demo)',
    yearsOfExperience: 10,
    bio: 'Demo account for local development.',
  },
});
const p = await upsertUser(DEMO.patient, { role: 'patient' });

let created = 0;
if (p.created) {
  const today = new Date();
  for (let i = 60; i >= 0; i -= 1) {
    if (i % 6 === 3 || i % 11 === 0) continue; // some missed days
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const entryDate = d.toISOString().slice(0, 10);
    // A gentle synthetic pattern: mood drifts up over time, stress moves inversely.
    const mood = Math.max(1, Math.min(10, Math.round(5 + (60 - i) / 20 + Math.sin(i / 3) * 1.5)));
    const stress = Math.max(1, Math.min(10, 11 - mood + (i % 4 === 0 ? 1 : 0)));
    const recordId = newRecordId();
    const sealed = sealRecord({
      recordId,
      patientId: p.user._id,
      entryDate,
      mood,
      stress,
      journal: JOURNAL_SNIPPETS[i % JOURNAL_SNIPPETS.length],
      tags: [...TAGS[i % TAGS.length]].sort(),
    });
    await WellnessRecord.create({ patient: p.user._id, recordId, entryDate, ...sealed });
    created += 1;
  }
}

console.log('Demo data ready (local development only):');
for (const [label, r] of [['therapist', t], ['patient', p]]) {
  console.log(`  ${label.padEnd(9)} ${r.user.email}  ${r.created ? `password: ${password}` : '(already existed, password unchanged)'}`);
}
console.log(`  ${created} synthetic check-ins created for the demo patient.`);
await disconnectDatabase();
