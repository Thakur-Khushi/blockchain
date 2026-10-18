import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

const ISSUER = 'mindchain-api';
const AUDIENCE = 'mindchain-client';

export function signAccessToken(user, tokenVersion) {
  return jwt.sign({ role: user.role, tv: tokenVersion }, config.JWT_SECRET, {
    subject: user._id.toString(),
    expiresIn: config.JWT_EXPIRES_IN,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
}
