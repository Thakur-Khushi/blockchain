# MindChain REST API

Base URL: `http://localhost:5000/api`. During development the Vite dev server proxies `/api`, so the client calls `/api/...` on its own origin.

## Conventions

- **Authentication:** send `Authorization: Bearer <JWT>` on every request except register, login and health. The server reloads the user on each request. A token stops working immediately after logout, after the account is suspended, or once it expires (default 2 h).
- **Request bodies:** JSON, at most 50 kB. Unknown fields are removed. Every input is validated against an exact schema with zod.
- **Errors** always have this shape:
  ```json
  { "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": [{ "location": "body", "field": "mood", "message": "Mood must be 1-10" }] } }
  ```
  | Status | `code` | Meaning |
  |---|---|---|
  | 400 | `BAD_REQUEST` | Validation failed, or malformed JSON |
  | 401 | `UNAUTHORIZED` | No session, or an invalid or expired one |
  | 403 | `FORBIDDEN` | Wrong role, therapist not verified, account suspended, or no consent |
  | 404 | `NOT_FOUND` | Not found, or not yours. Other users' resources also return 404, so you can't tell whether they exist |
  | 409 | `CONFLICT`, `TX_NOT_FOUND`, `NOT_ANCHORED`, `CHAIN_MISMATCH` | State conflict, or the chain doesn't confirm the claim |
  | 422 | `TX_FAILED` | The blockchain transaction reverted |
  | 429 | `TOO_MANY_REQUESTS` | Rate limit hit (auth and wallet endpoints) |
  | 503 | `CHAIN_UNAVAILABLE` | The blockchain can't be reached. The request is refused rather than answered without a chain check |
- **Pagination:** list endpoints accept `page` (default 1) and `limit` (default 20, maximum 100). They return `{ items, page, limit, total, totalPages }`.
- **Dates:** `YYYY-MM-DD` for check-in dates, and ISO 8601 date-times for timestamps.
- **Caching:** every API response carries `Cache-Control: no-store`.

## Roles

`patient`, `therapist` and `admin`. A therapist can use therapist features only once an admin has set them to `verificationStatus = verified`. Admins have no endpoint that returns journal content.

---

## Auth: `/api/auth`

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/register` | public, rate-limited | Body: `{ name, email, password, role: "patient" \| "therapist", therapistProfile? }`. `therapistProfile = { licenseNumber, licensingBody, specialization, yearsOfExperience, bio? }` is required for therapists, who start as `pending`. Admin accounts can't be registered here. Returns `201 { token, user }` |
| POST | `/login` | public, rate-limited | Body: `{ email, password }`. Returns `{ token, user }`. A wrong password and an unknown email give the same 401 |
| GET | `/me` | any | Returns `{ user }` |
| POST | `/logout` | any | Invalidates every token for this user (all devices). Returns `204` |

Passwords need at least 8 characters, letters and numbers, and must be at most 72 bytes (the bcrypt limit).

## Wallet and chain: `/api/wallet`, `/api/chain`

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/wallet/nonce` | any, rate-limited | Body: `{ address }`. Returns `201 { message, nonce, expiresAt }`. The message names the account, the checksummed wallet, the chain ID, a 256-bit nonce and the issue time. The nonce is stored hashed and expires after 10 minutes |
| POST | `/wallet/verify` | any, rate-limited | Body: `{ address, nonce, signature }`. The nonce is used up first, then the server rebuilds the message and recovers the signer. On success the wallet is linked and the response is `{ user }`. Replayed, expired, foreign or mismatched challenges are rejected. One wallet per account. A patient can't change wallet after anchoring records |
| GET | `/wallet` | any | Returns `{ walletAddress, registeredPatient, chain }`. `registeredPatient` is read live from the contract (`null` if the chain is unavailable) |
| GET | `/chain/status` | any | Returns `{ chain: { available, chainId, contractAddress, blockNumber?, reason? } }` |

## Wellness records: `/api/wellness` (patients only)

| Method | Path | Description |
|---|---|---|
| GET | `/scale` | The mood and stress scales (1–10) |
| POST | `/` | Body: `{ entryDate, mood, stress, journal?, tags? }`. Encrypts the record, computes its hash and creates it with `chainStatus: "pending"`. One check-in per date (409 if one exists). Returns `201 { record }` |
| GET | `/` | Query: `from`, `to`, `page`, `limit`. Your records, newest first |
| GET | `/:id` | One record by its `recordId` (`0x` + 64 hex characters) |
| PATCH | `/:id` | Body: any of `mood`, `stress`, `journal`, `tags`. Re-encrypts the record with a new salt and hash, increments `version`, and sets `chainStatus` back to `pending`. Returns 409 if the record fails its integrity check |
| DELETE | `/:id` | Crypto-shreds the record: the ciphertext, IV and tag are erased, and a marker keeps the `recordId` and hash. Returns `204` |
| POST | `/:id/anchor` | Body: `{ txHash? }`. Confirms a `registerRecord` or `updateRecord` transaction. Requires a successful receipt, from your linked wallet, sent to MindChain, whose event matches this `recordId` and the current hash, and whose live contract state matches. Without `txHash`, the anchor is recovered from contract events. A reverted transaction gives 422 and `chainStatus: "failed"` |
| POST | `/:id/revocation` | Body: `{ txHash }`. Confirms a `revokeRecord` transaction (allowed for deleted records) |
| GET | `/:id/verify` | Full verification (see below) |
| GET | `/analytics` | Query: `from`, `to` (default: the last 30 days; at most 366 days). Returns `{ analytics }` |
| GET | `/export` | Query: `format=json\|csv`, `from`, `to`. Your decrypted history as a file download. CSV cells are protected against formula injection |

A **record** object looks like this:

```json
{
  "id": "0x…", "recordId": "0x…", "entryDate": "2026-10-19",
  "mood": 7, "stress": 4, "journal": "…", "tags": ["sleep"],
  "digest": "0x…", "version": 1,
  "chainStatus": "pending|anchored|failed", "txHash": null, "chainId": null, "anchoredAt": null,
  "onChainAction": "register|update|null",
  "anchorHistory": [{ "action": "registered", "txHash": "0x…", "version": 1, "chainId": 31337, "at": "…" }],
  "integrity": { "status": "ok|tampered", "reason": null },
  "createdAt": "…", "updatedAt": "…"
}
```

`mood`, `stress`, `journal` and `tags` are omitted when the record fails its integrity check.

**Verification response** (`GET /:id/verify`):

```json
{ "verification": {
  "recordId": "0x…",
  "status": "verified|tampered|outdated|not_anchored|revoked|chain_unavailable",
  "reason": "…",
  "checks": { "decryption": "pass|fail", "digest": "pass|fail|skipped",
              "onChain": "pass|missing|mismatch|revoked|unavailable", "owner": "pass|fail|no_wallet|unavailable" },
  "onChain": { "owner": "0x…", "digest": "0x…", "version": 1, "revoked": false, "createdAt": 0, "updatedAt": 0 },
  "record": { "entryDate": "…", "createdAt": "…", "version": 1, "digest": "0x…", "chainStatus": "…", "txHash": "…", "anchoredAt": "…" },
  "network": { "chainId": 31337, "contractAddress": "0x…" },
  "verifiedAt": "…"
} }
```

**Analytics object:** `{ range, daily[{date,mood,stress}], weekly[{weekStart,days,checkIns,avgMood,avgStress}], monthly[{month,…}], completion{days,checkIns,rate,currentStreak,longestStreak}, summary{avgMood,avgStress,min/max,moodTrend,stressTrend,lowMoodDays,highStressDays,topTags}, insights[string], excludedRecords }`. Records that fail integrity checks are excluded and counted in `excludedRecords`.

## Consent: `/api/consents` (patients only)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Your grants, worked out from `AccessGranted` and `AccessRevoked` events and confirmed with a live `getGrant`. Returns `{ walletLinked, items[{ therapistWallet, therapist\|null, active, currentlyValid, grantedAt, expiresAt, history[] }] }` |
| POST | `/confirm` | Body: `{ txHash }`. Records a mined `grantAccess` or `revokeAccess` transaction in the audit trail (once per transaction). It doesn't change any permission; the contract has already done that |

Consent is changed only on-chain, through MetaMask, with `grantAccess(therapist, expiresAt)` and `revokeAccess(therapist)`.

## Therapists: `/api/therapists`

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/` | patient, admin | Directory of verified, active therapists (`search`, pagination). Licence numbers are never included |
| PUT | `/me/verification` | therapist | Body: `{ therapistProfile }`. Resubmits details after a rejection |
| GET | `/patients` | verified therapist | Patients whose on-chain grant to you is currently valid |
| GET | `/patients/:patientId` | verified therapist + consent | Patient name and grant details |
| GET | `/patients/:patientId/records` | verified therapist + consent | The patient's records (`from`, `to`, pagination). Audited |
| GET | `/patients/:patientId/analytics` | verified therapist + consent | Progress report (`from`, `to`). Audited |

**The consent gate runs on every request.** It requires all of the following:
1. The caller is an active therapist who has been verified by an admin.
2. Both sides have linked wallets.
3. A live call to `hasAccess(patientWallet, therapistWallet)` returns true.

Any failure is audited as `access_denied`. An unreachable chain gives 503. "No such patient" and "no consent" return the same 403.

## Appointments: `/api/appointments` (patients and verified therapists)

| Method | Path | Description |
|---|---|---|
| POST | `/` | Patient only. Body: `{ therapistId, scheduledAt (ISO, on a 15-minute boundary, 1 h–180 days ahead), durationMinutes: 30\|45\|60\|90, mode: "online"\|"in_person", note? }`. The note is encrypted. Overlapping active appointments for the therapist or the patient are rejected with 409 |
| GET | `/` | Query: `scope=upcoming\|past\|all`, `status`, pagination. Only your own appointments |
| PATCH | `/:id` | Body: `{ action }`. **Therapist:** `confirm` (requested → confirmed, in the future, no confirmed overlap), `decline` (requested), `cancel` (confirmed, in the future), `complete` (confirmed, after the start time). **Patient:** `cancel` (requested or confirmed, in the future). Non-participants get 404, actions the role can't perform get 403, and invalid state changes get 409 |

## Audit: `/api/audit`

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/me` | any | Events where you are the actor or the subject (`eventType`, `withTx=true` for transaction history, pagination) |

## Admin: `/api/admin` (admins only)

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | Users per role, pending therapists and suspended accounts |
| GET | `/therapists/pending` | Therapists awaiting review |
| PATCH | `/therapists/:id/verification` | Body: `{ status: "verified"\|"rejected", note? }` |
| GET | `/users` | Filters: `role`, `accountStatus`, `verificationStatus` |
| PATCH | `/users/:id/status` | Body: `{ accountStatus: "active"\|"suspended" }`. Suspending also invalidates the user's sessions. Admins can't change their own status or another admin's |
| GET | `/audit` | Filters: `eventType`, `outcome`. Events hold IDs, reason codes and transaction hashes only |

## Health

`GET /api/health` returns `{ "status": "ok" }`. No authentication is needed.
