// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  buildReviewDecisionPath,
  buildReviewDetailPath,
  buildReviewsPath
} from '../../web/src/api/reviews.js';
import { ApiError } from '../../web/src/api/client.js';
import {
  buildReviewMatrixRows,
  isEmptyReviewPage,
  previousReviewCursor,
  readReviewFilters,
  replaceReviewCursor,
  reviewDecisionError,
  reviewMutationRecovery,
  reviewQueueCopy,
  reviewStatusMeta,
  summarizeDecisionReadiness,
  summarizeReviewValidation
} from '../../web/src/pages/reviews-model.js';

describe('審核工作台列表模型', () => {
  it('只把治理 API 支援的篩選與固定頁長送到後端', () => {
    expect(
      buildReviewsPath({
        status: 'pending',
        os: 'linux',
        client: 'claude-code',
        cursor: '20'
      }),
    ).toBe(
      '/api/reviews?status=pending&os=linux&client=claude-code&cursor=20&limit=20'
    );
  });

  it('從網址恢復有效篩選，讓重新整理與瀏覽器返回保持同一佇列', () => {
    expect(
      readReviewFilters(
        new URLSearchParams(
          'status=approved&os=WINDOWS&client=Claude_Code&cursor=40'
        )
      ),
    ).toEqual({
        status: 'approved',
        os: 'windows',
        client: 'claude-code',
        cursor: '40'
      });
  });

  it('拒絕未知狀態、OS、Client 與非法游標，避免網址參數把頁面送進後端 400', () => {
    expect(
      readReviewFilters(
        new URLSearchParams(
          'status=unknown&cursor=-1&os=solaris&client=unreviewed-runtime'
        )
      )
    ).toEqual({ status: 'pending' });
  });

  it('上一頁游標按固定頁長回退，第一頁以缺少 cursor 表示', () => {
    expect(previousReviewCursor('40')).toBe('20');
    expect(previousReviewCursor('20')).toBeUndefined();
    expect(previousReviewCursor(undefined)).toBeUndefined();
  });

  it('回到第一頁時移除既有 cursor，而不是保留舊頁位置', () => {
    expect(
      replaceReviewCursor(
        { status: 'pending', os: 'linux', cursor: '20' },
        undefined
      )
    ).toEqual({ status: 'pending', os: 'linux' });
  });

  it('游標頁即使沒有資料仍保留分頁控制，讓使用者可以回上一頁', () => {
    const emptyResult = { items: [], nextCursor: undefined };

    expect(isEmptyReviewPage({ status: 'pending' }, emptyResult)).toBe(true);
    expect(
      isEmptyReviewPage({ status: 'pending', cursor: '20' }, emptyResult)
    ).toBe(false);
  });

  it('頁面標題跟隨狀態，避免已核准資料仍被標成待審', () => {
    expect(reviewQueueCopy('pending').title).toBe('待審佇列');
    expect(reviewQueueCopy('approved').title).toBe('已核准記錄');
  });

  it('驗證覆蓋以預期矩陣為分母，缺失結果不會被誤算成通過', () => {
    expect(
      summarizeReviewValidation({
        expectedMatrix: [
          { os: 'linux', client: 'codex' },
          { os: 'windows', client: 'codex' },
          { os: 'linux', client: 'claude-code' }
        ],
        matrixResults: [
          { status: 'passed' },
          { status: 'failed' }
        ]
      })
    ).toEqual({
        passed: 1,
        failed: 1,
        notSupported: 0,
        missing: 1,
        total: 3
    });
  });

  it('詳情與決議路徑編碼 review id，避免路徑字元改變 API 目標', () => {
    expect(buildReviewDetailPath('review /一')).toBe(
      '/api/reviews/review%20%2F%E4%B8%80'
    );
    expect(buildReviewDecisionPath('review /一', 'approve')).toBe(
      '/api/reviews/review%20%2F%E4%B8%80/approve'
    );
  });

  it('駁回要求非空理由，核准允許空理由，兩者都限制 5,000 字', () => {
    expect(reviewDecisionError('reject', '   ')).toBe('駁回必須填寫理由。');
    expect(reviewDecisionError('approve', '   ')).toBeUndefined();
    expect(reviewDecisionError('approve', 'x'.repeat(5001))).toBe(
      '決議理由最多 5,000 字。'
    );
  });

  it('詳情矩陣保留缺失的預期目標，不讓缺證據的組合從畫面消失', () => {
    expect(
      buildReviewMatrixRows(
        [
          { os: 'linux', client: 'codex' },
          { os: 'windows', client: 'codex' }
        ],
        [
          {
            os: 'linux',
            client: 'codex',
            runnerName: 'docker-linux',
            runnerVersion: '1.0.0',
            scriptDigest: 'sha256:test',
            startedAt: '2026-08-27T00:00:00.000Z',
            endedAt: '2026-08-27T00:00:01.000Z',
            installExitCode: 0,
            telemetrySeen: true,
            uninstallExitCode: 0,
            cleanupSucceeded: true,
            status: 'passed'
          }
        ]
      ).map(({ target, result }) => ({ target, status: result?.status }))
    ).toEqual([
      { target: { os: 'linux', client: 'codex' }, status: 'passed' },
      { target: { os: 'windows', client: 'codex' }, status: undefined }
    ]);
  });

  it('已決議狀態使用唯讀文案，pending 才允許顯示決議表單', () => {
    expect(reviewStatusMeta('pending')).toMatchObject({
      label: '待審',
      canDecide: true
    });
    expect(reviewStatusMeta('rejected')).toMatchObject({
      label: '已駁回',
      canDecide: false
    });
  });

  it('預期矩陣缺少 runner 結果時，不把空結果誤判為遙測與清理完成', () => {
    expect(
      summarizeDecisionReadiness({
        expectedMatrix: [{ os: 'linux', client: 'codex' }],
        matrixResults: []
      })
    ).toEqual({ telemetryComplete: false, cleanupComplete: false });
  });

  it('決議衝突立即重載；可能已寫入的網路錯誤先同步；一般 4xx 只顯示錯誤', () => {
    expect(
      reviewMutationRecovery(
        new ApiError({
          statusCode: 409,
          code: 'REVIEW_ALREADY_DECIDED',
          message: '審核已完成決議',
          retryable: false
        })
      )
    ).toBe('reload');
    expect(
      reviewMutationRecovery(
        new ApiError({
          statusCode: 0,
          code: 'NETWORK_ERROR',
          message: '網路中斷',
          retryable: true
        })
      )
    ).toBe('sync-required');
    expect(
      reviewMutationRecovery(
        new ApiError({
          statusCode: 403,
          code: 'REVIEWER_SCOPE_REQUIRED',
          message: '無權限',
          retryable: false
        })
      )
    ).toBe('show-error');
  });
});
