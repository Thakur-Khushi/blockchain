import mongoose from 'mongoose';

export const CHAIN_STATUSES = Object.freeze(['pending', 'anchored', 'failed']);

const notDeleted = function notDeleted() {
  return !this.isDeleted;
};

// Mood, stress, journal and tags are stored only inside the AES-256-GCM payload.
// entryDate stays in plaintext so records can be listed and filtered by date.
const wellnessRecordSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Random, non-identifying 32-byte id shared with the smart contract.
    recordId: { type: String, required: true, unique: true, match: /^0x[a-f0-9]{64}$/ },
    entryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    encryptedPayload: { type: String, required: notDeleted },
    iv: { type: String, required: notDeleted },
    authTag: { type: String, required: notDeleted },
    keyVersion: { type: Number, required: notDeleted, min: 1 },

    digest: { type: String, required: true, match: /^0x[a-f0-9]{64}$/ },
    digestVersion: { type: Number, required: true, default: 1 },
    version: { type: Number, required: true, default: 1, min: 1 },

    chainStatus: { type: String, enum: CHAIN_STATUSES, default: 'pending' },
    txHash: { type: String, match: /^0x[a-f0-9]{64}$/ },
    chainId: { type: Number },
    anchoredAt: { type: Date },

    // Confirmed on-chain transactions for this record (non-sensitive references only).
    anchorHistory: {
      type: [
        new mongoose.Schema(
          {
            action: { type: String, enum: ['registered', 'updated', 'revoked'], required: true },
            txHash: { type: String, match: /^0x[a-f0-9]{64}$/ },
            digest: { type: String, match: /^0x[a-f0-9]{64}$/ },
            version: { type: Number },
            chainId: { type: Number },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    chainRevoked: { type: Boolean, default: false },

    // Deletion crypto-shreds the payload and keeps a tombstone with the digest.
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

// One active check-in per patient per day.
wellnessRecordSchema.index(
  { patient: 1, entryDate: -1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

export const WellnessRecord = mongoose.model('WellnessRecord', wellnessRecordSchema);
