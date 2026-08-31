// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export type InstallErrorCode =
  | 'E001'
  | 'E002'
  | 'E003'
  | 'E004'
  | 'E005'
  | 'E006'
  | 'E999';

export type TelemetryStatus =
  | 'downloaded'
  | 'succeeded'
  | 'failed'
  | 'uninstalled';

export interface TelemetryReport extends Record<string, unknown> {
  idempotency_key: string;
  package_id: string;
  version: string;
  user_ref: string;
  user_ref_type: 'uid' | 'uuid';
  os_type: 'macos' | 'linux' | 'windows' | 'wsl';
  client_runtime: string;
  status: TelemetryStatus;
  error_code?: string;
  start_time: string;
  end_time: string;
  script_version?: number;
  options?: Record<string, string | boolean>;
}

export type TelemetryOptions = Record<string, string | boolean>;

export interface CanonicalTelemetryEvent {
  idempotencyKey: string;
  packageId: string;
  version: string;
  userRef: string;
  userRefType: 'uid' | 'uuid';
  osType: 'macos' | 'linux' | 'windows' | 'wsl';
  clientRuntime: string;
  status: TelemetryStatus;
  errorCode: InstallErrorCode | null;
  scriptVersion?: number | null;
  options?: TelemetryOptions | null;
  startedAt: Date;
  endedAt: Date;
  payloadFingerprint: string;
  receivedAt: Date;
}

export interface TelemetryRecord extends CanonicalTelemetryEvent {
  id: string;
}

export interface TelemetryReceipt {
  record: TelemetryRecord;
  duplicate: boolean;
  droppedFields: string[];
}
