# MindChain

Blockchain-based mental health monitoring and patient–therapist management system
(final-year Computer Science project).

> Status: under development. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the
> architecture and phase plan. Full setup instructions will be added in Phase 10.

| Folder | Purpose |
|---|---|
| `client/` | React + Vite frontend (Tailwind, Recharts, ethers/MetaMask) |
| `server/` | Express + MongoDB REST API (JWT, RBAC, AES-256-GCM) |
| `blockchain/` | Hardhat project with the `MindChain.sol` contract, Ignition modules, tests |

MindChain is a wellness-tracking tool. It does not provide clinical diagnosis and does not replace
professional mental healthcare.
