import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid id');

export const email = z.string().trim().toLowerCase().max(254).email('Invalid email address');

// bcrypt only uses the first 72 bytes of input, so longer passwords are rejected.
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');

// Plain-text field: trimmed, length-limited, control characters removed.
export const safeText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));
