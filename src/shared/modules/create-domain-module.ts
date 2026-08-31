// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

export function createDomainModule(name: string): FastifyPluginAsync {
  return fastifyPlugin(async () => undefined, { name });
}
