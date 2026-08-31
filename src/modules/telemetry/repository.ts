// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { CanonicalTelemetryEvent, TelemetryRecord } from './types.js';

export interface TelemetryRepository {
  ingest(event: CanonicalTelemetryEvent): Promise<{
    record: TelemetryRecord;
    duplicate: boolean;
  }>;
}
