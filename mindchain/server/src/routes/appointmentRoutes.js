import { Router } from 'express';
import * as appointments from '../controllers/appointmentController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export function appointmentRoutes() {
  const router = Router();
  router.use(authenticate);
  router.post('/', authorize('patient'), validate({ body: appointments.createBody }), appointments.createAppointment);
  router.get('/', authorize('patient', 'therapist'), validate({ query: appointments.listQuery }), appointments.listAppointments);
  router.patch(
    '/:id',
    authorize('patient', 'therapist'),
    validate({ params: appointments.idParams, body: appointments.updateBody }),
    appointments.updateAppointment,
  );
  return router;
}
