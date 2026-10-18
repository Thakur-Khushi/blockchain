import mongoose from 'mongoose';

export const APPOINTMENT_STATUSES = Object.freeze(['requested', 'confirmed', 'declined', 'cancelled', 'completed']);
export const APPOINTMENT_MODES = Object.freeze(['online', 'in_person']);
// Statuses that occupy a time slot for double-booking checks.
export const ACTIVE_STATUSES = Object.freeze(['requested', 'confirmed']);

const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    therapist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduledAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, enum: [30, 45, 60, 90] },
    mode: { type: String, enum: APPOINTMENT_MODES, default: 'online' },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'requested' },
    // Optional patient note, AES-256-GCM encrypted (it may describe health concerns).
    note: {
      ciphertext: { type: String },
      iv: { type: String },
      authTag: { type: String },
      keyVersion: { type: Number },
    },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    statusChangedAt: { type: Date },
  },
  { timestamps: true },
);

appointmentSchema.index({ therapist: 1, scheduledAt: 1 });
appointmentSchema.index({ patient: 1, scheduledAt: 1 });
appointmentSchema.index({ status: 1, scheduledAt: 1 });

export const Appointment = mongoose.model('Appointment', appointmentSchema);
