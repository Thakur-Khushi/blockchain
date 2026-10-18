import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthLimiter } from './middleware/rateLimit.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { therapistRoutes } from './routes/therapistRoutes.js';
import { wellnessRoutes } from './routes/wellnessRoutes.js';

// Builds the Express app. Options allow tests to override rate limits.
export function createApp(options = {}) {
  const app = express();
  const authLimiter = createAuthLimiter({
    windowMs: options.authRateLimitWindowMs ?? config.AUTH_RATE_LIMIT_WINDOW_MS,
    max: options.authRateLimitMax ?? config.AUTH_RATE_LIMIT_MAX,
  });

  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? false);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow non-browser clients (no Origin header) and the configured frontend origins only.
        if (!origin || config.CLIENT_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '50kb' }));

  // API responses may contain private data; never cache them.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes({ authLimiter }));
  app.use('/api/therapists', therapistRoutes());
  app.use('/api/admin', adminRoutes());
  app.use('/api/wellness', wellnessRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
