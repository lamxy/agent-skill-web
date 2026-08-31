// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type { NotificationPage, UserNotification } from './types.js';

export async function fetchNotifications(
  status: 'unread' | 'read' | undefined,
  signal: AbortSignal
): Promise<UserNotification[]> {
  const search = status ? `?status=${status}` : '';
  const response = await request<NotificationPage>(
    `/api/notifications${search}`,
    { signal }
  );
  return response.items;
}

export async function markNotificationRead(
  notificationId: string
): Promise<UserNotification> {
  return request<UserNotification>(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST', body: {} }
  );
}
