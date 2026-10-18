import { rateLimit } from 'express-rate-limit';

export function createAuthLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' },
      });
    },
  });
}
