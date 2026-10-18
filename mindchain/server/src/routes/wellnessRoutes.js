import { Router } from 'express';
import * as wellness from '../controllers/wellnessController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

// Patient-only endpoints for the patient's own records. Therapist access to a
// patient's records goes through separate consent-checked routes.
export function wellnessRoutes() {
  const router = Router();
  router.use(authenticate, authorize('patient'));

  router.get('/scale', wellness.scale);
  router.post('/', validate({ body: wellness.createBody }), wellness.createRecord);
  router.get('/', validate({ query: wellness.listQuery }), wellness.listRecords);
  router.get('/:id', validate({ params: wellness.recordIdParams }), wellness.getRecord);
  router.patch(
    '/:id',
    validate({ params: wellness.recordIdParams, body: wellness.updateBody }),
    wellness.updateRecord,
  );
  router.delete('/:id', validate({ params: wellness.recordIdParams }), wellness.deleteRecord);
  return router;
}
