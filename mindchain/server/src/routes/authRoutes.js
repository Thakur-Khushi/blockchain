import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export function authRoutes({ authLimiter }) {
  const router = Router();
  router.post('/register', authLimiter, validate({ body: auth.registerSchema }), auth.register);
  router.post('/login', authLimiter, validate({ body: auth.loginSchema }), auth.login);
  router.get('/me', authenticate, auth.me);
  router.post('/logout', authenticate, auth.logout);
  return router;
}
