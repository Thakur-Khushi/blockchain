# MindChain — Implementation Plan

This document records the architecture and design decisions that every phase builds on.
It is updated as phases are completed.

## 1. Environment (verified in Phase 1)

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.8.0 | Hardhat 3 requires Node ≥ 22 |
| npm | 8.3.2 | |
| MongoDB | 8.2 (Windows service, `127.0.0.1:27017`) | Used for dev and for backend tests (separate test DB) |
| Git | present, but **no repository is initialised and no Git commands will be run** | |

## 2. Technology choices

| Layer | Choice | Reason |
|---|---|---|
| Contracts | Solidity 0.8.34 (optimizer on), Hardhat 3.20, Hardhat Ignition, `hardhat-toolbox-mocha-ethers` | Current Hardhat major version; Mocha + Chai + ethers v6 tests |
| Backend | Node 24, Express 5, Mongoose 9, `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `zod`, `ethers` v6 | Express 5 forwards async errors natively; `zod` for validation |
| Password hashing | `bcryptjs` (bcrypt algorithm, cost 12) | Same algorithm as native `bcrypt` with no native build step on Windows |
| Backend tests | Node built-in test runner (`node --test`) + Supertest, one throw-away database per test file on the local MongoDB (Jest ESM support is still experimental) | Blockchain calls are injected so that failures and revocations can be simulated deterministically. A separate integration test runs against a real Hardhat node |
| Frontend | Vite, React 19, React Router 7, Tailwind CSS 4 (`@tailwindcss/vite`), Axios, Recharts 3, ethers v6 | |

## 3. Architecture

```
React (Vite) ──REST/JWT──► Express API ──► MongoDB (encrypted records)
     │                         │
     │ MetaMask (patient-       │ read-only JsonRpcProvider
     │ signed transactions)     │ (consent checks, digest verification,
     ▼                          ▼  transaction receipt checks)
              MindChain.sol on local Hardhat network (chainId 31337)
```

The backend holds **no wallet private key**. Every state-changing contract call is signed by the
patient in MetaMask. The backend only reads chain state and checks it.

## 4. Key design decisions

### 4.1 Wallet linking (proof of ownership)
1. `POST /api/wallet/nonce`: the server creates a single-use random nonce (stored hashed, 10-minute TTL) for the logged-in user.
2. The client asks MetaMask to `personal_sign` a message that includes the app name, the user ID, the wallet address, the chain ID, the nonce, and the issue time.
3. `POST /api/wallet/verify`: the server rebuilds the exact message, runs `ethers.verifyMessage`, checks that the recovered address matches, and deletes the nonce so it can't be replayed. The address is then saved, lower-cased, under a unique index (one wallet per account).

### 4.2 Wellness record lifecycle
1. `POST /api/wellness` (patient): validate the input, generate a random `recordId` (32 bytes), and generate a random 32-byte `salt`.
2. Build the canonical record (see 4.4), then compute `digest = SHA-256(canonical)`.
3. Encrypt `{mood, stress, journal, tags, salt}` with AES-256-GCM. The IV is a random 96-bit value. The AAD binds `recordId|patientId|keyVersion`, so ciphertext can't be moved to another record or patient.
4. Save the record with status `pending`. Return `recordId` and `digest` to the client.
5. The client calls `MindChain.registerRecord(recordId, digest)` through MetaMask.
6. `POST /api/wellness/:id/anchor {txHash}`: the server fetches the receipt with a read-only provider. It requires a successful receipt sent to the MindChain contract, an on-chain owner equal to the patient's linked wallet, and an on-chain digest equal to the stored digest. Only then is the status set to `anchored` and the tx hash saved.
7. If the transaction fails or is rejected, the record stays `pending` or becomes `failed`. The UI never shows it as verified, and the patient can retry anchoring.

Edits re-encrypt the record, compute a new digest, and set the status back to `pending` until the patient
signs `updateRecord(recordId, newDigest)`. Deletes remove the ciphertext off-chain and call
`revokeRecord`. Only a non-identifying hash ever existed on-chain.

### 4.2a Check-in rules (Phase 3)
- **Mood scale:** 1–10, where 1 is very low and 10 is very good.
- **Stress scale:** 1–10, where 1 is very relaxed and 10 is extremely stressed.
- Both scores are self-reported and descriptive only. They are not a clinical measure.
- Each patient has at most one active check-in per calendar date (`YYYY-MM-DD`). Dates up to one day ahead of UTC are accepted to allow for time zones.
- A journal can be up to 5000 characters. A check-in can have up to 10 tags, which are lower-cased, de-duplicated and sorted before hashing.
- Records are addressed by `recordId`, and every query is scoped to the logged-in patient. Requesting another patient's record returns 404.

### 4.3 Verification (`GET /api/wellness/:id/verify`)
These checks are independent, and each one is reported on its own:
- **decrypt**: the GCM authentication tag is valid. This detects tampered ciphertext, IV, tag or AAD.
- **digest**: the recomputed SHA-256 matches the stored digest.
- **chain**: the on-chain digest for `recordId` matches, and the record is not revoked.
- **owner**: the on-chain owner matches the patient's linked wallet.

The overall status is `verified` only if every check passes. Otherwise it is `tampered`, `not_anchored` or `chain_unavailable`.

### 4.4 Canonical record representation (version 1)
This is UTF-8 JSON with keys in this fixed order and no whitespace:
`{"v":1,"recordId":<hex>,"patientId":<id>,"entryDate":"YYYY-MM-DD","mood":<int 1-10>,"stress":<int 1-10>,"journal":<string>,"tags":[...],"salt":<hex>}`

The salt stops anyone guessing low-entropy entries (for example "mood 5, empty journal") from the public hash.

### 4.5 Consent (authoritative source = smart contract)
- `grantAccess(therapist, expiresAt)` and `revokeAccess(therapist)` are signed by the patient. `expiresAt = 0` means no expiry.
- On every protected disclosure to a therapist, the backend checks all of these:
  1. JWT valid.
  2. Role is `therapist`, the account is active, and the therapist is verified by an admin.
  3. Both parties have linked wallets.
  4. Live `hasAccess(patientWallet, therapistWallet)` is read from the chain. Nothing is cached.
  5. An audit event is written (`record_access` or `access_denied`).
- If the chain can't be reached, access is **denied** (fail closed).
- Limitation, documented in the README: revocation can't remove information a therapist has already viewed or copied.

### 4.5a `MindChain.sol` interface (Phase 4)
The contract has no owner or admin role. Every write applies only to the caller's own data.

| Function | Caller | Notes |
|---|---|---|
| `registerPatient()` | any wallet, once | Emits `PatientRegistered` |
| `grantAccess(therapist, expiresAt)` | registered patient | Re-granting overwrites the expiry. Rejects the zero address, self-grants and past expiries |
| `revokeAccess(therapist)` | registered patient | Requires an active grant |
| `hasAccess(patient, therapist)` | view | Returns true only if the grant is active and has not expired. This is what the backend checks |
| `getGrant(patient, therapist)` | view | Returns `active`, `grantedAt`, `expiresAt` and `currentlyValid` |
| `registerRecord(recordId, digest)` | registered patient | Rejects zero values and IDs that already exist |
| `updateRecord(recordId, newDigest)` | record owner | Increments `version` and rejects an unchanged digest |
| `revokeRecord(recordId)` | record owner | The record then never verifies again |
| `getRecord(recordId)` / `recordExists` / `verifyRecord(recordId, digest)` | view | |

Event parameters are only addresses, `bytes32` values and integers. The contract uses custom errors (for example `NotRegisteredPatient`, `NotRecordOwner` and `InvalidExpiry`), which the frontend decodes into readable messages.

**Privacy limitation:** grant events publicly link a patient wallet to a therapist wallet. Patients should use a wallet dedicated to MindChain that isn't tied to their real-world identity.

### 4.6 Encryption keys
- `ENCRYPTION_KEY` (32 bytes, hex) comes from an environment variable and is validated at startup. Records store a `keyVersion` so keys can be rotated.
- Production should use a KMS or HSM with envelope encryption. This is documented, not implemented.

### 4.7 Roles
- **patient**: owns their records, analytics, consent and appointments.
- **therapist**: needs `verificationStatus = verified` for therapist features. A wallet address alone never establishes professional identity.
- **admin**: verifies therapists, manages account status, and reads audit events that contain no record content. Admins have **no** access to journals. Admin accounts are created by a seed script, never through public registration.

## 5. Phases

| # | Phase | Main deliverables |
|---|---|---|
| 1 | Inspect & structure | Folders, `.gitignore`, this plan |
| 2 | Backend foundation | Express app, config validation, Mongo connection, User/Audit models, auth (register/login/me/logout), JWT + RBAC middleware, rate limiting, error handling, tests |
| 3 | Encryption & wellness API | AES-GCM service, canonical digest, WellnessRecord model, CRUD + pagination, isolation tests, tamper tests |
| 4 | Smart contract | `MindChain.sol`, Ignition module, full unit tests |
| 5 | Chain + MetaMask integration | Deploy script exporting ABI/address, backend read-only chain service, wallet nonce/sign linking, client wallet context |
| 6 | Consent & verification | Anchor endpoint, verify endpoint, therapist record access with live consent checks, audit trail, revocation tests |
| 7 | Dashboards | Patient / therapist / admin UIs, layout, routing, protected routes |
| 8 | Analytics & appointments | Backend analytics aggregation, Recharts views, appointment model/API/UI, authorization tests |
| 9 | Integration | End-to-end workflow script against Hardhat node + MongoDB, bug fixing |
| 10 | Documentation | README: setup, env vars, deployment, tests, API reference, troubleshooting, limitations |
