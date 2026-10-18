import { Router } from 'express';
import * as therapists from '../controllers/therapistController.js';
import { authenticate, authorize, requireVerifiedTherapist } from '../middleware/auth.js';
import { requireConsent } from '../middleware/consent.js';
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

  // Patient data: verified therapist + live on-chain consent on every request.
  router.get('/patients', requireVerifiedTherapist, therapists.listMyPatients);
  router.get('/patients/:patientId', requireVerifiedTherapist, requireConsent(), therapists.getPatientSummary);
  router.get(
    '/patients/:patientId/records',
    requireVerifiedTherapist,
    requireConsent(),
    validate({ query: therapists.patientRecordsQuery }),
    therapists.listPatientRecords,
  );
  return router;
}
