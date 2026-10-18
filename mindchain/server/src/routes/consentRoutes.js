import { Router } from 'express';
import * as audit from '../controllers/auditController.js';
import * as consent from '../controllers/consentController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export function consentRoutes() {
  const router = Router();
  router.use(authenticate, authorize('patient'));
  router.get('/', consent.listMyGrants);
  router.post('/confirm', validate({ body: consent.confirmBody }), consent.confirmConsentTransaction);
  return router;
}

export function auditRoutes() {
  const router = Router();
  router.get('/me', authenticate, validate({ query: audit.myAuditQuery }), audit.listMyAuditEvents);
  return router;
}
