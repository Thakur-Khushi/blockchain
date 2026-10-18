import './setup.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDatabase } from '../../src/config/db.js';
import { User } from '../../src/models/User.js';
import { signAccessToken } from '../../src/services/tokenService.js';

export async function startDb() {
  await connectDatabase(process.env.MONGODB_URI);
}

export async function stopDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export const PASSWORD = 'Passw0rd123';

let counter = 0;
// Creates a user directly in the database and returns it with a valid token.
export async function createUser(overrides = {}) {
  counter += 1;
  const role = overrides.role ?? 'patient';
  const user = await User.create({
    name: `Test ${role} ${counter}`,
    email: `${role}${counter}-${Date.now()}@example.test`,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role,
    verificationStatus: role === 'therapist' ? 'pending' : 'not_applicable',
    therapistProfile:
      role === 'therapist'
        ? { licenseNumber: 'LIC-001', licensingBody: 'State Board', specialization: 'CBT', yearsOfExperience: 5 }
        : undefined,
    ...overrides,
  });
  return { user, token: signAccessToken(user, 0) };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
