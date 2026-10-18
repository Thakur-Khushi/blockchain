import mongoose from 'mongoose';
import { ChainUnavailableError } from '../services/chainService.js';
import { AppError } from '../utils/AppError.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`, 'NOT_FOUND'));
}

// Consistent error shape: { error: { code, message, details? } }.
// Internal error messages and stack traces are never sent to the client.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

  if (err instanceof AppError) {
    status = err.statusCode;
    body = { code: err.code ?? 'ERROR', message: err.message, details: err.details };
  } else if (err instanceof ChainUnavailableError) {
    // Fail closed: nothing that depends on the chain is released without it.
    status = 503;
    body = { code: 'CHAIN_UNAVAILABLE', message: err.message };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'BAD_REQUEST', message: 'Malformed JSON body' };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    body = {
      code: 'BAD_REQUEST',
      message: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { code: 'BAD_REQUEST', message: 'Invalid identifier' };
  } else if (err?.code === 11000) {
    status = 409;
    body = { code: 'CONFLICT', message: 'A record with these details already exists' };
  }

  if (status === 503) {
    console.warn(`[warn] ${req.method} ${req.path}: ${body.message}`);
  } else if (status >= 500) {
    // Log only the error, never the request body (it may contain journal text or passwords).
    console.error(`[error] ${req.method} ${req.path}:`, err);
  }
  res.status(status).json({ error: body });
}
