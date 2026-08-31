// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ResolvedIdentity } from './types.js';

export type InstallationUserReference =
  | { type: 'uid'; value: string }
  | { type: 'uuid'; value: string };

export function toInstallationUserReference(
  identity: ResolvedIdentity
): InstallationUserReference {
  return identity.kind === 'authenticated'
    ? { type: 'uid', value: identity.uid }
    : { type: 'uuid', value: identity.anonymousId };
}
