import { AuditEvent } from '../models/AuditEvent.js';

// Audit logging must never break the request that triggered it, and must never
// log request bodies — callers pass only identifiers and short reason codes.
export async function recordAudit({ eventType, actor, subject, outcome, recordId, txHash, detail }) {
  try {
    await AuditEvent.create({ eventType, actor, subject, outcome, recordId, txHash, detail });
  } catch (err) {
    console.error(`[audit] failed to write ${eventType} event: ${err.message}`);
  }
}
