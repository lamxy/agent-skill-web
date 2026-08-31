// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { InstallationUserReference } from '../identity/installation-user-reference.js';
import type {
  ClientRuntime,
  ScriptOptionDefinition,
  ScriptTargetOs,
  ScriptTargetRecord
} from '../catalog/types.js';

export type { ScriptTargetOs } from '../catalog/types.js';

/** `target` 是 v2 唯一真實來源；其餘命令欄位只保留一個相容週期。 */
export interface GenerateScriptInput {
  packageId: string;
  version: string;
  publishedAt?: Date;
  target?: ScriptTargetRecord;
  action?: 'install' | 'uninstall';
  selectedOptions?: Record<string, string | boolean>;
  targetOs?: ScriptTargetOs | 'linux';
  clientRuntime?: ClientRuntime | string;
  installCommand?: string;
  uninstallCommand?: string;
  hasResidualEffects?: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  userReference: InstallationUserReference;
  telemetryEndpoint: string;
}

export interface GeneratedScript {
  packageId: string;
  version: string;
  publishedAt: string;
  targetOs: ScriptTargetOs;
  action: 'install' | 'uninstall';
  clientRuntime: string;
  scriptVersion: number;
  resolvedOptions: Record<string, string | boolean>;
  filename: string;
  executionCommand: string;
  telemetryAssurance: 'best-effort';
  script: string;
  digest: string;
  preview: {
    installCommand: string;
    uninstallCommand: string;
    usageInstructions: string;
    options: ScriptOptionDefinition[];
    hasResidualEffects: boolean;
    residualDescription?: string;
    manualCleanupSteps?: string;
    telemetryFields: string[];
  };
}
