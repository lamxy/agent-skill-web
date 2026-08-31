-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

-- 驗證執行新增 skipped 狀態，支撐 VALIDATION_MODE=manual 的人工審核模式。
--
-- 為什麼不直接沿用 passed：
-- 機器審未實際執行時若標記為 passed，審核者會誤以為腳本已通過自動驗證，
-- 而實際上沒有跑過任何驗證。skipped 讓「未驗證」在資料層就與「已驗證通過」
-- 明確區分，審核工作台據此提示審核者自行到真實環境確認。

alter table validation_runs
  drop constraint if exists validation_runs_status_check;

alter table validation_runs
  add constraint validation_runs_status_check
  check (status in ('running', 'passed', 'failed', 'skipped'));

-- attempts 以 jsonb 存於 validation_runs.attempts，無獨立資料表與約束，
-- 其 status 由應用層型別把關，不需要在此調整。
