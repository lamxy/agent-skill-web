// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyError, FastifyInstance } from 'fastify';

import { AppError } from './app-error.js';

function isValidationError(error: unknown): error is FastifyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray(error.validation)
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, request, reply) => {
    if (isValidationError(error)) {
      await reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '請求欄位驗證失敗'
        }
      });
      return;
    }

    if (error instanceof AppError) {
      await reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message }
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled request error');
    await reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '系統發生未預期錯誤'
      }
    });
  });
}
