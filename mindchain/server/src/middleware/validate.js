import { badRequest } from '../utils/AppError.js';

// Parses body/query/params with zod schemas. Validated values are placed on
// req.valid (Express 5 makes req.query read-only); unknown body keys are stripped.
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const valid = {};
    const issues = [];
    for (const [key, schema, source] of [
      ['body', body, req.body ?? {}],
      ['query', query, req.query ?? {}],
      ['params', params, req.params ?? {}],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(source);
      if (result.success) valid[key] = result.data;
      else {
        for (const issue of result.error.issues) {
          issues.push({ location: key, field: issue.path.join('.'), message: issue.message });
        }
      }
    }
    if (issues.length) throw badRequest('Validation failed', issues);
    req.valid = valid;
    next();
  };
}
