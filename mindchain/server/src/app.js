import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthLimiter } from './middleware/rateLimit.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { appointmentRoutes } from './routes/appointmentRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { auditRoutes, consentRoutes } from './routes/consentRoutes.js';
import { therapistRoutes } from './routes/therapistRoutes.js';
import { chainRoutes, walletRoutes } from './routes/walletRoutes.js';
import { wellnessRoutes } from './routes/wellnessRoutes.js';
import { createChainServiceFromConfig } from './services/chainService.js';

// Builds the Express app. Options let tests override rate limits and inject a
// chain service (e.g. a fake that simulates outages or revoked consent).
export function createApp(options = {}) {
  const app = express();
  const authLimiter = createAuthLimiter({
    windowMs: options.authRateLimitWindowMs ?? config.AUTH_RATE_LIMIT_WINDOW_MS,
    max: options.authRateLimitMax ?? config.AUTH_RATE_LIMIT_MAX,
  });

  const walletLimiter = createAuthLimiter({
    windowMs: options.authRateLimitWindowMs ?? config.AUTH_RATE_LIMIT_WINDOW_MS,
    max: (options.authRateLimitMax ?? config.AUTH_RATE_LIMIT_MAX) * 2,
  });
  app.locals.chain = options.chain ?? createChainServiceFromConfig();

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
  app.use('/api/wallet', walletRoutes({ walletLimiter }));
  app.use('/api/chain', chainRoutes());
  app.use('/api/consents', consentRoutes());
  app.use('/api/audit', auditRoutes());
  app.use('/api/appointments', appointmentRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
