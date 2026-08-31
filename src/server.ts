// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import 'dotenv/config';

import { createApp } from './app.js';
import {
  HealthMonitor,
  startHealthMonitor
} from './modules/monitoring/health-monitor.js';
import { NotificationAlertSink } from './modules/monitoring/notification-alert-sink.js';
import {
  createChannels,
  createSharedTargets
} from './modules/notification/channel-factory.js';
import { loadConfig } from './shared/config/config.js';
import { createPostgresDatabase } from './shared/database/postgres-database.js';

const config = loadConfig();
const database = createPostgresDatabase(config.databaseUrl);
const app = await createApp({ config, database });

// 健康輪詢：僅在已配置通知渠道時啟動，否則告警無處可送。
const alertTargets = createSharedTargets(config.notification);
const monitorSchedule =
  alertTargets.length > 0
    ? startHealthMonitor(
        new HealthMonitor({
          probe: { check: async () => database.ping() },
          sink: new NotificationAlertSink(
            createChannels({ config: config.notification }),
            alertTargets
          ),
          logger: app.log
        }),
        Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 60_000)
      )
    : undefined;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    monitorSchedule?.stop();
    void app.close();
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'Application failed to start');
  monitorSchedule?.stop();
  await app.close();
  process.exitCode = 1;
}
