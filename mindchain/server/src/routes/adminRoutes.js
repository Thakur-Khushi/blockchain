import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';

export function adminRoutes() {
  const router = Router();
  router.use(authenticate, authorize('admin'));

  router.get('/stats', admin.stats);
  router.get('/therapists/pending', validate({ query: paginationSchema }), admin.listPendingTherapists);
  router.patch(
    '/therapists/:id/verification',
    validate({ params: admin.idParams, body: admin.verificationBody }),
    admin.setTherapistVerification,
  );
  router.get('/users', validate({ query: admin.listUsersQuery }), admin.listUsers);
  router.patch(
    '/users/:id/status',
    validate({ params: admin.idParams, body: admin.accountStatusBody }),
    admin.setAccountStatus,
  );
  router.get('/audit', validate({ query: admin.auditQuery }), admin.listAuditEvents);
  return router;
}
