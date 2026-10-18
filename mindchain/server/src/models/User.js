import mongoose from 'mongoose';

export const ROLES = Object.freeze(['patient', 'therapist', 'admin']);
export const VERIFICATION_STATUSES = Object.freeze(['not_applicable', 'pending', 'verified', 'rejected']);
export const ACCOUNT_STATUSES = Object.freeze(['active', 'suspended']);

const therapistProfileSchema = new mongoose.Schema(
  {
    licenseNumber: { type: String, trim: true, maxlength: 64 },
    licensingBody: { type: String, trim: true, maxlength: 120 },
    specialization: { type: String, trim: true, maxlength: 120 },
    yearsOfExperience: { type: Number, min: 0, max: 70 },
    bio: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'patient' },
    walletAddress: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    therapistProfile: { type: therapistProfileSchema, default: undefined },
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'not_applicable',
    },
    verificationNote: { type: String, trim: true, maxlength: 500 },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'active' },
    // Incremented on logout / suspension; tokens carrying an older version are rejected.
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

// One wallet per account; the partial filter lets many users have no wallet.
userSchema.index(
  { walletAddress: 1 },
  { unique: true, partialFilterExpression: { walletAddress: { $type: 'string' } } },
);
userSchema.index({ role: 1, verificationStatus: 1, accountStatus: 1 });

userSchema.virtual('isVerifiedTherapist').get(function isVerifiedTherapist() {
  return this.role === 'therapist' && this.verificationStatus === 'verified';
});

export const User = mongoose.model('User', userSchema);
