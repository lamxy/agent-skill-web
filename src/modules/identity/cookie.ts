// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

interface IdentityCookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const fragment of header.split(';')) {
    const separatorIndex = fragment.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = fragment.slice(0, separatorIndex).trim();
    const value = fragment.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return cookies;
}

export function serializeIdentityCookie(
  name: string,
  value: string,
  options: IdentityCookieOptions
): string {
  const secure = options.secure ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Max-Age=${options.maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}
