// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/**
 * 錯誤分類。retryable 決定介面是否提供「重新載入」，
 * 因此判斷依據必須是「重試有機會成功」，而不是「錯誤嚴不嚴重」。
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: {
    statusCode: number;
    code: string;
    message: string;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

/**
 * 網路中斷、逾時與 5xx 重試有機會成功；408 與 429 是明確的「稍後再試」。
 * 其餘 4xx 屬請求本身的問題，重試只會得到相同結果。
 */
function isRetryable(statusCode: number): boolean {
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500;
}

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  error?: ErrorBody;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return {};
    const parsed = body as ErrorBody;
    return parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed;
  } catch {
    return {};
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      // 同源部署，session 由 HttpOnly Cookie 承載；
      // same-origin 讓瀏覽器自動攜帶，不需要 CORS 設定。
      credentials: 'same-origin',
      ...(options.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(options.body)
          }),
      ...(options.signal ? { signal: options.signal } : {})
    });
  } catch (error) {
    // 呼叫端主動取消不是錯誤，原樣拋出讓上層忽略
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError({
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: '無法連線到平台，請確認網路後重試。',
      retryable: true
    });
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiError({
      statusCode: response.status,
      code: typeof body.code === 'string' ? body.code : 'UNKNOWN_ERROR',
      message:
        typeof body.message === 'string' && body.message.trim()
          ? body.message
          : '平台回應異常，請稍後重試。',
      retryable: isRetryable(response.status)
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
