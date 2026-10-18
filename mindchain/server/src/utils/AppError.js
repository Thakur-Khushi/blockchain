// Operational error with an HTTP status that is safe to show to the client.
export class AppError extends Error {
  constructor(statusCode, message, code = undefined, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Resource not found') => new AppError(404, msg, 'NOT_FOUND');
export const conflict = (msg) => new AppError(409, msg, 'CONFLICT');
