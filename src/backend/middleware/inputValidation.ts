// ---------------------------------------------------------------------------
// Input Validation Middleware
// ---------------------------------------------------------------------------
// AJV-based request body and query parameter validation.
// Provides a factory that takes a JSON Schema and returns middleware
// that validates incoming data before it reaches route handlers.
// ---------------------------------------------------------------------------

import Ajv, { type JSONSchemaType, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// AJV Instance (singleton, compiled schemas are cached)
// ---------------------------------------------------------------------------

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: 'all',  // Strip unknown properties (defense in depth)
  coerceTypes: false,
  useDefaults: true,
});
addFormats(ajv);

// ---------------------------------------------------------------------------
// Middleware Factories
// ---------------------------------------------------------------------------

/**
 * Validates req.body against the provided JSON schema.
 * Returns 400 with detailed error messages on failure.
 */
export function validateBody<T>(schema: JSONSchemaType<T> | object) {
  const validate: ValidateFunction = ajv.compile(schema);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body || Object.keys(req.body).length === 0) {
      res.status(400).json({ error: 'Request body is required' });
      return;
    }

    const valid = validate(req.body);
    if (!valid) {
      res.status(400).json({
        error: 'Validation failed',
        details: validate.errors?.map(e => ({
          path: e.instancePath || '/',
          message: e.message,
          params: e.params,
        })),
      });
      return;
    }

    next();
  };
}

/**
 * Validates req.query against the provided JSON schema.
 * Returns 400 with detailed error messages on failure.
 */
export function validateQuery<T>(schema: JSONSchemaType<T> | object) {
  const validate: ValidateFunction = ajv.compile(schema);

  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = validate(req.query);
    if (!valid) {
      res.status(400).json({
        error: 'Query validation failed',
        details: validate.errors?.map(e => ({
          path: e.instancePath || '/',
          message: e.message,
          params: e.params,
        })),
      });
      return;
    }

    next();
  };
}

/**
 * Validates req.params against the provided JSON schema.
 */
export function validateParams<T>(schema: JSONSchemaType<T> | object) {
  const validate: ValidateFunction = ajv.compile(schema);

  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = validate(req.params);
    if (!valid) {
      res.status(400).json({
        error: 'Path parameter validation failed',
        details: validate.errors?.map(e => ({
          path: e.instancePath || '/',
          message: e.message,
          params: e.params,
        })),
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Common Schemas (reusable across routes)
// ---------------------------------------------------------------------------

export const schemas = {
  /** Validates that :alias is a safe slug */
  tenantAlias: {
    type: 'object',
    properties: {
      alias: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$' },
    },
    required: ['alias'],
    additionalProperties: true,
  },

  /** Pagination query params */
  pagination: {
    type: 'object',
    properties: {
      page: { type: 'string', pattern: '^[0-9]+$' },
      limit: { type: 'string', pattern: '^[0-9]+$' },
    },
    additionalProperties: true,
  },
} as const;
