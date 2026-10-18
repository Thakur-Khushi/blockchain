import { Router } from 'express';
import * as wallet from '../controllers/walletController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export function walletRoutes({ walletLimiter }) {
  const router = Router();
  router.use(authenticate);
  router.get('/', wallet.walletStatus);
  router.post('/nonce', walletLimiter, validate({ body: wallet.nonceBody }), wallet.requestNonce);
  router.post('/verify', walletLimiter, validate({ body: wallet.verifyBody }), wallet.verifyWallet);
  return router;
}

export function chainRoutes() {
  const router = Router();
  router.get('/status', authenticate, wallet.chainStatus);
  return router;
}
