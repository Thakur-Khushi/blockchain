# MindChain

MindChain is a blockchain-based mental health monitoring and patient–therapist management system, built as a final-year Computer Science project.

- **Patients** record daily mood and stress with a private journal. Their records are encrypted, and each one gets a fingerprint anchored on a blockchain so any tampering can be detected.
- **Consent:** patients decide which verified therapists can read their records, and can revoke that access at any time.
- **Therapists** see records only while the patient's on-chain consent is valid. The server checks this on every request.
- **Administrators** verify therapists and review security events. They have no access to journals.

> MindChain is a self-tracking and care-coordination tool. Its scores are self-reported and descriptive. It does not diagnose any condition and does not replace professional mental healthcare.

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Technology stack](#technology-stack)
4. [Project structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Setup and running locally](#setup-and-running-locally)
7. [MetaMask setup](#metamask-setup)
8. [Environment variables](#environment-variables)
9. [Smart contract](#smart-contract)
10. [Main workflows](#main-workflows)
11. [Testing](#testing)
12. [API reference](#api-reference)
13. [Security and privacy design](#security-and-privacy-design)
14. [Known limitations](#known-limitations)
15. [Production notes](#production-notes)
16. [Troubleshooting](#troubleshooting)

---

## Features

| Area | What is implemented |
|---|---|
| **Authentication** | Registration and login. bcrypt password hashing (cost 12). JWT sessions, checked against the database on every request. Logout and suspension cancel sessions immediately. Rate-limited auth endpoints |
| **Roles** | Patient, therapist and admin. Every permission is enforced on the backend; frontend route guards are only for navigation |
| **Wellness tracker** | Daily mood (1–10) and stress (1–10), private journal, tags. History with date filters, editing and deletion. One check-in per day |
| **Encryption** | AES-256-GCM for each record, with a random IV, the authentication tag stored, and the ciphertext tied to its record and patient (AAD). Supports key versions and rotation |
| **Integrity** | A salted SHA-256 fingerprint of a fixed record format is anchored on-chain. The four-step verification checks decryption, the fingerprint, the on-chain fingerprint and the owner. Tampering is reported clearly |
| **Smart contract** | `MindChain.sol`: patient registration, consent grants with optional expiry, revocation, record registration, update and withdrawal, and verification. Custom errors and events. No owner or admin powers |
| **Consent** | Granted and revoked by the patient in MetaMask. The backend re-checks the contract before **every** disclosure and refuses if the chain is unreachable. Full audit trail |
| **Wallet linking** | The patient signs a one-time message in MetaMask. It names the account, wallet, chain, nonce and time, and the nonce is single-use |
| **Appointments** | Patients request sessions; therapists confirm, decline, cancel or complete them. Validates state changes, times and double-booking. Encrypted notes |
| **Analytics** | Calculated on the server: daily, weekly and monthly trends, check-in completion and streaks, and plain-language summaries. Recharts charts with a table view for each |
| **Dashboards** | Separate patient, therapist and admin areas. Responsive sidebar and mobile drawer. Loading, empty and error states. Transaction status indicators |
| **Export** | Patients can download their own history as CSV or JSON |

## Architecture

```
┌──────────────────────────┐    REST + JWT     ┌──────────────────────────┐     ┌──────────────────────┐
│  React client (Vite)     │ ────────────────► │  Express API             │ ──► │ MongoDB              │
│  • dashboards, charts    │                   │  • auth, RBAC, validation│     │ • users, audit log   │
│  • MetaMask (ethers v6)  │                   │  • AES-256-GCM, SHA-256  │     │ • encrypted records  │
└────────────┬─────────────┘                   │  • consent gate          │     │ • appointments       │
             │ patient-signed transactions     └────────────┬─────────────┘     └──────────────────────┘
             │ (register, anchor, grant, revoke)            │ read-only JSON-RPC
             ▼                                              ▼ (hasAccess, getRecord, receipts, events)
        ┌───────────────────────────────────────────────────────────────┐
        │  MindChain.sol on a local Hardhat network (chain id 31337)    │
        │  only random record IDs, salted hashes and wallet addresses   │
        └───────────────────────────────────────────────────────────────┘
```

- **The backend never holds a wallet private key.** Every change on-chain is signed by the patient in MetaMask. The server only reads the chain, to verify receipts, consent and fingerprints.
- **Personal data stays off-chain.** Journals, scores, names and emails stay in MongoDB, and health data is encrypted.
- **The contract is the source of truth for consent.** The database holds no copy of permissions.

The full design notes are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), and the full API is in [docs/API.md](docs/API.md).

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, React Router 7, Axios, Recharts 3, ethers 6 |
| Backend | Node.js 24 (needs Node 22 or newer), Express 5, Mongoose 9 (MongoDB 8), jsonwebtoken, bcryptjs, helmet, express-rate-limit, zod, ethers 6 |
| Blockchain | Solidity 0.8.34, Hardhat 3.20, Hardhat Ignition, Mocha, Chai, ethers |
| Testing | Hardhat Mocha tests, Node's built-in test runner with Supertest, Playwright end-to-end tests in Edge or Chrome |

## Project structure

```
mindchain/
├── blockchain/                 Hardhat 3 project
│   ├── contracts/MindChain.sol
│   ├── ignition/modules/MindChain.js
│   ├── scripts/export-deployment.js   copies address + ABI to server and client
│   ├── test/MindChain.test.js
│   └── hardhat.config.js
├── server/                     Express API
│   ├── src/
│   │   ├── config/             env validation, MongoDB connection, deployment.json (generated)
│   │   ├── models/             User, WellnessRecord, Appointment, AuditEvent, WalletNonce
│   │   ├── controllers/        auth, wellness, consent, therapist, appointment, admin, audit, wallet
│   │   ├── routes/
│   │   ├── middleware/         auth (JWT + RBAC), consent gate, validation, rate limits, errors
│   │   ├── services/           crypto, record digest, integrity, chain (read-only), consent, analytics, reports
│   │   └── utils/
│   ├── scripts/                seed-admin.js, seed-demo.js
│   └── tests/                  unit, API and chain integration tests
├── client/                     React app
│   └── src/
│       ├── components/  layouts/  pages/{patient,therapist,admin}/
│       ├── context/            AuthContext, WalletContext (MetaMask)
│       ├── hooks/              useTransaction, useAnchor, useAsync
│       ├── services/           api (axios), contract (ABI, error decoding), format
│       └── contracts/          deployment.json (generated)
├── e2e/                        Playwright suite + stack orchestrator
├── docs/                       IMPLEMENTATION_PLAN.md, API.md
├── package.json                convenience scripts
└── .gitignore
```

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 22 or newer** (24 recommended) | Hardhat 3 needs Node 22 or newer. Check with `node -v` |
| **npm 8 or newer** | |
| **MongoDB 6 or newer** running locally | Developed against MongoDB 8.2 on `127.0.0.1:27017`. MongoDB Atlas also works if you set `MONGODB_URI` |
| **MetaMask** browser extension | Needed for blockchain actions in the UI |
| Microsoft Edge or Google Chrome | Only for the end-to-end tests |

## Setup and running locally

All commands run from the `mindchain/` folder. You need **four terminals**: the chain, the API, the client, and one for one-off commands.

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure the server

```bash
cp server/.env.example server/.env        # Windows PowerShell: Copy-Item server/.env.example server/.env
```

Generate the two secrets and paste them into `server/.env`:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Also set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the administrator account. The client needs no `.env` file for local development; `client/.env.example` lists the optional settings.

### 3. Start the local blockchain (terminal 1)

```bash
npm run chain
```

This prints 20 funded **development** accounts and their private keys. Keep the terminal open. The chain lives in memory and resets every time you restart it.

### 4. Compile and deploy the contract (terminal 4)

```bash
npm run deploy
```

This compiles `MindChain.sol`, deploys it with Hardhat Ignition to `localhost:8545`, and writes `server/src/config/deployment.json` and `client/src/contracts/deployment.json` (address and ABI only).

> **Every time you restart the chain, run `npm run deploy` again and restart the API.**

### 5. Create the administrator, and optionally demo data (terminal 4)

```bash
npm run seed:admin      # uses ADMIN_EMAIL / ADMIN_PASSWORD from server/.env
npm run seed:demo       # optional: a verified demo therapist and a demo patient with ~60 days of synthetic check-ins
```

`seed:demo` prints the demo login details. It uses `DEMO_PASSWORD` if you set it, and otherwise generates a random password. The demo records aren't anchored on-chain until you link a wallet and anchor them from **Record integrity**.

### 6. Start the API (terminal 2) and client (terminal 3)

```bash
npm run server          # http://localhost:5000  (health: /api/health)
npm run client          # http://localhost:5173
```

Open **http://localhost:5173**, register as a patient or therapist, or log in as the admin.

## MetaMask setup

1. **Add the local network.** The app offers to add it the first time you connect. To add it by hand: network name `Hardhat Local`, RPC URL `http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`.
2. **Import development accounts.** Copy a private key printed by `npm run chain` (for example account #1 for a patient and account #2 for a therapist), then use MetaMask's *Add account → Import account*.
   > These keys are **public test keys** that every Hardhat installation shares. **Never send real funds to them or use them on a real network.**
3. **Link the wallet in the app.** On the **Wallet** page: connect, choose *Link this wallet* (sign the free message), and, if you're a patient, choose *Register on MindChain* (a transaction).
4. Use **one MetaMask account per MindChain user**. A wallet can be linked to only one account.

## Environment variables

### `server/.env`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | | `development` | `development`, `test` or `production` |
| `PORT` | | `5000` | API port |
| `MONGODB_URI` | ✔ | — | MongoDB connection string |
| `JWT_SECRET` | ✔ | — | At least 32 characters. Signs session tokens |
| `JWT_EXPIRES_IN` | | `2h` | Session lifetime |
| `ENCRYPTION_KEY` | ✔ | — | 64 hex characters (32 bytes). AES-256-GCM key for health data. **If you lose it, existing records can't be read** |
| `ENCRYPTION_KEY_VERSION` | | `1` | Version number of the current key |
| `ENCRYPTION_PREVIOUS_KEYS` | | empty | Retired keys for reading older records, as `1:<hex>,2:<hex>` |
| `RPC_URL` | | `http://127.0.0.1:8545` | Read-only JSON-RPC endpoint |
| `RPC_TIMEOUT_MS` | | `5000` | Chain call timeout. A timeout counts as the chain being unavailable |
| `DEPLOYMENT_FILE` | | `src/config/deployment.json` | Written by `npm run deploy` |
| `CONTRACT_ADDRESS`, `CHAIN_ID` | | empty | Optional overrides for the deployment file |
| `WALLET_NONCE_TTL_SECONDS` | | `600` | Lifetime of a wallet-linking challenge |
| `CLIENT_ORIGIN` | | `http://localhost:5173` | Allowed CORS origins, comma-separated |
| `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS` | | `20` / `900000` | Login and registration attempts per IP per window |
| `BCRYPT_ROUNDS` | | `12` | Must be at least 12 in production |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | for `seed:admin` | — | Administrator account |

The server validates this configuration at startup and refuses to start if anything is missing or malformed.

### `client/.env` (optional)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `/api` | API base path. In development the Vite dev server proxies `/api` |
| `VITE_RPC_URL` | `http://127.0.0.1:8545` | RPC URL suggested to MetaMask when adding the network |
| `API_PROXY_TARGET` | `http://localhost:5000` | Development proxy target. It isn't exposed to the browser |

Only `VITE_*` values reach the browser. **Never put secrets in client environment variables.**

## Smart contract

`blockchain/contracts/MindChain.sol` has no owner or admin role. Each function changes only the caller's own data.

| Function | Caller | Purpose |
|---|---|---|
| `registerPatient()` | any wallet, once | Registers the wallet as a patient |
| `grantAccess(therapist, expiresAt)` | registered patient | Grants or updates access. `expiresAt = 0` means no expiry. Rejects the zero address, self-grants and past expiries |
| `revokeAccess(therapist)` | registered patient | Revokes an active grant |
| `hasAccess(patient, therapist)` | view | `true` only for an active grant that hasn't expired |
| `registerRecord(recordId, digest)` | registered patient | Anchors a new record fingerprint |
| `updateRecord(recordId, digest)` | record owner | Anchors the fingerprint of an edited record and increments its version |
| `revokeRecord(recordId)` | record owner | Withdraws a record. It never verifies again |
| `getRecord`, `recordExists`, `verifyRecord`, `getGrant` | view | Read helpers |

Events (`PatientRegistered`, `AccessGranted`, `AccessRevoked`, `RecordRegistered`, `RecordUpdated`, `RecordRevoked`) carry only addresses, `bytes32` values and integers.

```bash
cd blockchain
npm run compile         # hardhat build
npm test                # 23 unit tests
npm run node            # local chain
npm run deploy:local    # Ignition deploy to localhost + export to server/client
```

The project config defines no public network. Deploying to a public network would need an explicit decision, an RPC URL, and a key stored with `npx hardhat keystore set`, never in a file.

## Main workflows

### Daily check-in and anchoring
1. The patient saves a check-in. The server validates it, generates a random 32-byte `recordId` and a 32-byte salt, and computes `digest = SHA-256(canonical JSON)`. It then encrypts `{mood, stress, journal, tags, salt}` with AES-256-GCM, with the AAD set to the record ID, patient and key version, and stores the record as `pending`.
2. The patient chooses **Anchor on blockchain** and signs `registerRecord(recordId, digest)` in MetaMask. A first-time user signs `registerPatient()` first.
3. The client sends the transaction hash to the server. The server fetches the receipt and requires all of the following before marking the record **anchored**:
   - the transaction succeeded;
   - it came from the linked wallet;
   - it was sent to MindChain;
   - its event names this record and its current fingerprint;
   - the live contract state matches.
4. Editing a check-in re-encrypts it and produces a new fingerprint. Verification then reports **outdated** until the patient signs `updateRecord`.

### Verification
`GET /api/wellness/:id/verify` decrypts the record (the authentication tag check), recomputes the fingerprint, reads the on-chain fingerprint and owner, and reports each check separately. The overall status is **verified** only if all four pass. Otherwise it is `tampered`, `outdated`, `not_anchored`, `revoked` or `chain_unavailable`. It is never "verified" when the chain can't be reached.

### Consent
1. The patient picks a verified therapist and an expiry, then signs `grantAccess`.
2. The client reports the transaction for the audit trail.
3. Each time the therapist requests records or a progress report, the server checks the following, with no caching:
   - the therapist account is active and verified by an admin;
   - both sides have linked wallets;
   - the live `hasAccess(patientWallet, therapistWallet)` call returns true.
4. Every access and every denial is audited. The patient sees them under **Activity & transactions**.
5. After `revokeAccess`, the very next request is refused.

### Therapist verification
A therapist registers with their licence details and starts as **pending**. An admin checks the licence with the issuing body and verifies or rejects the account. A rejected therapist can resubmit. Until they're verified, a therapist can't book appointments or open patient data, **even if a patient has granted their wallet access**.

### Appointments
A patient requests a slot. The therapist confirms or declines it. Either side can cancel before the start time. The therapist marks it completed after it has started. Overlapping bookings are rejected.

## Testing

| Suite | Command | Coverage |
|---|---|---|
| Smart contract | `npm run test:contracts` | 23 tests: registration, grants, expiry, revocation, unauthorised callers, invalid inputs, record registration, update, revocation and verification, privacy of event data |
| Backend | `npm run test:server` | 133 tests (needs MongoDB; each file uses its own throwaway database). See below |
| End-to-end | `npm run test:e2e` | 11 browser tests (Edge or Chrome): the full three-role workflow against a real Hardhat node, the API and MongoDB |
| Everything | `npm test` | All of the above, plus a production build of the client |

**What the backend tests cover:**
- Authentication, roles and therapist verification.
- Isolation between patients' records.
- Encryption and decryption, tampered ciphertext, IV, tag, AAD and fingerprints, and key rotation.
- Wallet signatures, including replay, expiry and wrong-signer cases.
- Anchoring, including failed, foreign and mismatched transactions.
- Access refused after consent is revoked or expires, and when the chain is down.
- Appointment authorisation and state changes.
- Analytics correctness and isolation, and CSV injection.
- 7 integration tests against a real Hardhat node.

**How the end-to-end suite works.** `e2e/run-e2e.mjs` sets up and tears down an isolated stack:
- a Hardhat node on port 8555;
- the API on port 5055, with a `mindchain_e2e` database and secrets generated for each run;
- Vite on port 5174.

It doesn't touch your `server/.env` or development database. The tests replace MetaMask with an injected EIP-1193 provider that forwards signing and transactions to unlocked Hardhat accounts. The application code runs exactly as it would with MetaMask, and only the extension's confirmation popup is skipped. Screenshots are saved to `e2e/.tmp/screens/`. Use `npm run test:headed --prefix e2e` to watch the run.

## API reference

See **[docs/API.md](docs/API.md)** for every endpoint, its parameters, response shapes and error codes. In summary:

| Prefix | Purpose |
|---|---|
| `/api/auth` | register, login, me, logout |
| `/api/wallet`, `/api/chain` | signed-nonce wallet linking, chain status |
| `/api/wellness` | patient records (CRUD), `/:id/anchor`, `/:id/revocation`, `/:id/verify`, `/analytics`, `/export` |
| `/api/consents` | the patient's on-chain grants, consent transaction confirmation |
| `/api/therapists` | therapist directory, verification resubmission, consented patients, consent-gated records and analytics |
| `/api/appointments` | request, list, and change appointment status |
| `/api/audit/me` | personal access log and transaction history |
| `/api/admin` | stats, therapist verification, user status, audit log |

## Security and privacy design

- **Passwords:** bcrypt with cost 12. Inputs longer than 72 bytes are rejected. A wrong password and an unknown email look the same, both in the message and in response time.
- **Sessions:**
  - JWTs are signed with HS256 and carry an issuer and audience.
  - Each token includes a `tokenVersion`, which is incremented on logout and suspension.
  - The user is reloaded on every request.
  - The client keeps the token in `sessionStorage`, which is cleared when the tab closes and isn't sent automatically, so there's no CSRF risk.
- **Authorisation:**
  - Role middleware is applied to every route.
  - Resources belonging to other users return 404, so their existence isn't revealed.
  - The patient ID always comes from the session, never from the request body.
  - Admins have no endpoint that returns journal content.
- **Input handling:**
  - Strict zod schemas for body, query and params, which also block NoSQL operator injection.
  - Control characters are stripped.
  - Request bodies are limited to 50 kB.
  - CSV exports are protected against formula injection.
- **Transport and headers:** `helmet` security headers, a CORS allow-list, `Cache-Control: no-store` on all API responses, and `x-powered-by` disabled.
- **Rate limiting:** on login, registration and the wallet endpoints.
- **Encryption at rest:**
  - AES-256-GCM with a 96-bit random IV and a 128-bit authentication tag.
  - The ciphertext is tied to `recordId`, `patientId` and the key version through AAD.
  - Mood, stress, journal, tags and appointment notes are encrypted.
  - Deleting a record crypto-shreds it.
- **Fingerprint:** salted SHA-256 over a documented, canonical format (see [IMPLEMENTATION_PLAN.md §4.4](docs/IMPLEMENTATION_PLAN.md)). The salt stops anyone working out simple entries from the public hash.
- **Wallet ownership:** EIP-191 `personal_sign` over a message naming the account, wallet, chain, nonce and time. The nonce is 256 bits, stored hashed, single-use (consumed before the signature is checked), and expires after 10 minutes.
- **Fail closed:** if the chain can't be reached, times out, is the wrong network, or the contract is missing, consent checks deny access and verification never reports success.
- **Logs and events:** server logs never include request bodies. Audit events hold only IDs, reason codes and transaction hashes. On-chain data is limited to wallet addresses, random IDs and salted hashes.

## Known limitations

- **Revocation isn't recall.** Revoking stops all future access, but it can't erase information a therapist has already viewed, noted or copied.
- **On-chain metadata is public.** Anyone can see that a patient wallet granted access to a therapist wallet, and when records were anchored. Use a wallet that isn't tied to your real identity.
- **Server-side encryption.** The server holds the key and decrypts for authorised users. This protects against database leaks and tampering, but not against a fully compromised server. End-to-end (client-side) encryption is a possible extension.
- **Key management.** The key comes from an environment variable. Rotation is supported for reading old records, but there's no bulk re-encryption tool.
- **Scale shortcuts:**
  - Consent discovery scans contract events from block 0. A production system would use an indexer such as The Graph or a database projection.
  - Rate limits are held in memory for each process.
  - The double-booking check isn't wrapped in a database transaction.
- **Tokens in `sessionStorage`** can be read by injected scripts. The app renders no untrusted HTML, but a strict CSP and short token lifetimes matter in production. There are no refresh tokens; users sign in again after 2 hours.
- **MetaMask popups** are tested by hand. The automated end-to-end suite uses an injected test wallet in place of the extension.
- **Not certified.** The system hasn't been assessed for HIPAA, GDPR or medical-device compliance, and the 1–10 scales aren't clinically validated instruments.
- **Single local network.** The chain is developed and tested on Hardhat only.

## Production notes

Before any real deployment:

- Keep secrets in a **secret manager**: `JWT_SECRET`, plus `ENCRYPTION_KEY` in a **KMS or HSM**, ideally with envelope encryption (a data key per record, wrapped by the KMS).
- Serve over **HTTPS only**. Set `trust proxy` correctly behind a load balancer so rate limits see real client IPs. Use a shared rate-limit store such as Redis.
- Add a strict **Content Security Policy** for the client, along with monitoring and alerting on `access_denied` spikes.
- Get the contract **audited**. Decide on the network deliberately (for example a permissioned or L2 network). Store deployment keys in a hardware wallet or keystore, and replace event scanning with an indexer.
- Put in place backups, retention policies, a data-subject request process, and a legal review for the health-data regulations that apply.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid server configuration` on startup | A required variable in `server/.env` is missing or malformed. The message names it. `ENCRYPTION_KEY` must be exactly 64 hex characters |
| `MongooseServerSelectionError` / `ECONNREFUSED 27017` | MongoDB isn't running. Start the service (Windows: `net start MongoDB`) or fix `MONGODB_URI` |
| The Wallet page shows **Contract not deployed**, or the API says *MindChain contract is not deployed* | Run `npm run deploy` (with `npm run chain` running), then restart the API |
| Chain status **Unavailable / RPC node unreachable**; therapists get 503 | The Hardhat node isn't running, or it restarted. Run `npm run chain`, then `npm run deploy`, then restart the API |
| *Contract not found at the configured address* | The chain was restarted, which wiped it. Redeploy and restart the API |
| MetaMask: **nonce too high**, or transactions stuck after restarting the chain | MetaMask still remembers the old chain. Go to **Settings → Advanced → Clear activity tab data** for that account |
| MetaMask shows the wrong network | Choose **Switch to Hardhat Local** on the Wallet page, or add chain 31337 by hand (see MetaMask setup) |
| "MetaMask is using a different account than your linked wallet" | Select the linked account in MetaMask. Each MindChain user needs their own MetaMask account |
| *Your records are anchored to your current wallet* | By design, a patient can't change wallet after anchoring, because it would break the ownership proof |
| Therapist sees "awaiting administrator verification" | An admin has to verify them under **Therapist verification** |
| A record shows **Not anchored** after its transaction was mined | Open **Record integrity** and choose **Check chain** to recover the anchor from contract events |
| `429 Too many attempts` | Wait for the rate-limit window, or raise `AUTH_RATE_LIMIT_MAX` for local development |
| CORS errors | Use the Vite dev server (it proxies `/api`), or add your origin to `CLIENT_ORIGIN` |
| `EADDRINUSE` on 5000, 5173 or 8545 | Stop the other process or change the port (`PORT`, `npx vite --port`, `npx hardhat node --port`) |
| Hardhat errors about the Node version | Hardhat 3 needs Node 22 or newer |
| End-to-end tests can't find a browser | Install Edge or Chrome, or set `E2E_BROWSER_CHANNEL=chrome` |
