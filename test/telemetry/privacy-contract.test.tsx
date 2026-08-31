// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PrivacyPage } from '../../web/src/pages/PrivacyPage.js';

describe('隱私聲明遙測契約', () => {
  it('對使用者逐欄公開十三欄白名單與 options 敏感邊界', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    const fields = [
      'idempotency_key',
      'package_id',
      'version',
      'user_ref',
      'user_ref_type',
      'os_type',
      'client_runtime',
      'status',
      'error_code',
      'start_time',
      'end_time',
      'script_version',
      'options'
    ];

    for (const field of fields) expect(html).toContain(`>${field}<`);
    expect(html).toContain('安裝時選擇的參數名與選擇值');
    expect(html).toContain('不會回報其他環境變數');
  });
});
