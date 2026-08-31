// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export {
  createChannels,
  createSharedTargets,
  type ChannelFactoryOptions
} from './channel-factory.js';
export {
  EmailChannel,
  LarkChannel,
  SlackChannel,
  TeamsChannel,
  type EmailTransport,
  type WebhookChannelOptions
} from './channels.js';
export {
  MemoryDeliveryLog,
  NotificationDispatcher,
  StaticRecipientDirectory,
  type DeliveryLog,
  type DispatchRecord,
  type NotificationDispatcherOptions,
  type RecipientDirectory
} from './notification-dispatcher.js';
export { renderNotification, renderPlainText } from './templates.js';
export {
  notificationChannelKinds,
  notificationEventTypes,
  type DeliveryOutcome,
  type DeliveryTarget,
  type NotificationChannel,
  type NotificationChannelKind,
  type NotificationEvent,
  type NotificationEventType,
  type RenderedNotification
} from './types.js';
