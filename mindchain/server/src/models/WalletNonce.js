import mongoose from 'mongoose';

// Single-use challenge for proving wallet ownership. Only a SHA-256 hash of the
// nonce is stored; MongoDB's TTL monitor removes expired challenges.
const walletNonceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    address: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
    nonceHash: { type: String, required: true },
    chainId: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);

walletNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WalletNonce = mongoose.model('WalletNonce', walletNonceSchema);
