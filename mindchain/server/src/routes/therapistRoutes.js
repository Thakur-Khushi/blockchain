import { Router } from 'express';
import * as therapists from '../controllers/therapistController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export function therapistRoutes() {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    authorize('patient', 'admin'),
    validate({ query: therapists.listTherapistsQuery }),
    therapists.listVerifiedTherapists,
  );
  router.put(
    '/me/verification',
    authorize('therapist'),
    validate({ body: therapists.resubmitBody }),
    therapists.resubmitVerification,
  );
  return router;
}
