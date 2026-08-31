// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { generateScript } from '../api/catalog.js';
import { ApiError } from '../api/client.js';
import type { GeneratedScript } from '../api/types.js';
import { useProvideFooterAction } from '../api/footer-action-context.js';
import { usePageState } from '../api/use-page-state.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { PageStateView } from '../components/PageStateView.js';
import { Button, Chip } from '../components/primitives.js';
import './install-preview.css';

/** 與 PackageDetailPage 的檔名規則一致 */
function scriptExtension(targetOs: string): string {
  return targetOs === 'windows' ? 'ps1' : 'sh';
}

/**
 * 觸發腳本下載。頁面內與頁腳的下載鍵共用同一份行為，
 * 避免兩處各自組檔名而在日後出現分歧。
 */
function downloadScript(data: GeneratedScript): void {
  // 瀏覽器沙箱不允許頁面自行寫檔，改以 Blob 觸發下載
  const blob = new Blob([data.script], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.action}-${data.packageId}-${data.version}-${data.targetOs}.${scriptExtension(data.targetOs)}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * 中部邊界由後端 script-generator-service.ts 生成的固定註解界定。
 * bash 以 `# 維護者…命令：只在隔離子程序執行` 起、`_asp_exit_code=$?` 迄；
 * PowerShell 以 `# 維護者…命令` 起、`if ($LASTEXITCODE -ne 0) {` 迄。
 * 後端調整這些標記時此處需同步，否則中部標示會退化為不標示。
 */
const MID_BOUNDARY = {
  linux: { start: /^# 維護者(?:安裝|解除安裝)命令：/, end: /^_asp_exit_code=\$\?/ },
  windows: { start: /^\s*# 維護者(?:安裝|解除安裝)命令$/, end: /^\s*if \(\$LASTEXITCODE -ne 0\) \{/ }
} as const;

interface ScriptLine {
  number: number;
  text: string;
  mid: boolean;
}

/**
 * 標出哪幾行屬於發布者的中部命令。找不到邊界時全部視為非中部：
 * 標錯段落會讓員工誤判哪段是平台生成，比不標示更糟。
 */
function markSegments(script: string, targetOs: string): ScriptLine[] {
  const boundary =
    targetOs === 'windows' ? MID_BOUNDARY.windows : MID_BOUNDARY.linux;
  const rawLines = script.split('\n');

  const startIndex = rawLines.findIndex((line) => boundary.start.test(line));
  const endIndex =
    startIndex === -1
      ? -1
      : rawLines.findIndex(
          (line, index) => index > startIndex && boundary.end.test(line)
        );
  const found = startIndex !== -1 && endIndex !== -1;

  return rawLines.map((text, index) => ({
    number: index + 1,
    text,
    mid: found && index >= startIndex && index < endIndex
  }));
}

function TargetChips({ data }: { data: GeneratedScript }): ReactNode {
  return (
    <div className="ip-target">
      <Chip>{data.packageId}</Chip>
      <Chip mono>{data.version}</Chip>
      <Chip>{data.targetOs === 'windows' ? 'Windows' : 'Linux / macOS'}</Chip>
      <Chip>{data.clientRuntime}</Chip>
    </div>
  );
}

/**
 * 只列出有確定來源的三條。前兩條是平台固定行為，第三條來自
 * preview.hasResidualEffects。套件專屬的寫入路徑與權限需求後端尚無欄位，
 * 不在此推導，見 docs/前端實作指導.md 的安裝頁章節。
 */
function WhatItDoes({ data }: { data: GeneratedScript }): ReactNode {
  const { preview } = data;
  return (
    <section className="ip-card">
      <div className="ip-card-h">
        <h2 className="ip-card-t">這份腳本會做什麼</h2>
      </div>
      <div className="ip-card-b">
        <ul className="ip-rows">
          <li>
            <span className="ip-dot ip-dot-info" />
            <div>
              <b>在本機保存一組 UUID</b>
              <p>
                未登入時會在本機產生並保存一組 UUID，用於回報安裝結果。
                同一台機器沿用同一組，平台無法由此反查你的真實身份。
              </p>
            </div>
          </li>
          <li>
            <span className="ip-dot ip-dot-info" />
            <div>
              <b>執行結束時回報結果</b>
              <p>
                回報時間、系統環境與成功或失敗。離線時排入本機佇列，下次執行補交。
                不收集命令輸出與檔案內容。
              </p>
            </div>
          </li>
          {preview.hasResidualEffects ? (
            <li>
              <span className="ip-dot ip-dot-warn" />
              <div>
                <b>解除安裝後會留下內容</b>
                <p>
                  {preview.residualDescription ?? '發布者未提供殘留說明。'}
                  {preview.manualCleanupSteps
                    ? ` 完全移除請執行：${preview.manualCleanupSteps}`
                    : ''}
                </p>
              </div>
            </li>
          ) : (
            <li>
              <span className="ip-dot ip-dot-ok" />
              <div>
                <b>解除安裝後不留殘留</b>
                <p>發布者聲明解除安裝會清除所有寫入內容。</p>
              </div>
            </li>
          )}
        </ul>
        <p className="ip-note">
          發布者的{data.action === 'uninstall' ? '解除安裝' : '安裝'}命令會做什麼，需展開下方完整腳本的中部自行檢視。
        </p>
      </div>
    </section>
  );
}

function ScriptBlock({ data }: { data: GeneratedScript }): ReactNode {
  const lines = useMemo(
    () => markSegments(data.script, data.targetOs),
    [data.script, data.targetOs]
  );
  return (
    <section className="ip-card">
      <div className="ip-card-h">
        <h2 className="ip-card-t">完整腳本</h2>
        <span className="ip-card-s tabular">{lines.length} 行</span>
        <span className="ip-card-act">
          <Button variant="primary" onClick={() => downloadScript(data)}>
            下載安裝腳本
          </Button>
        </span>
      </div>
      <div className="ip-card-b">
        {/* 分段切換為第一期的純視覺佔位，不接功能 */}
        <div className="ip-seg" aria-hidden="true">
          <button type="button" data-on disabled>
            全部
          </button>
          <button type="button" disabled>
            上部
          </button>
          <button type="button" disabled>
            中部
          </button>
          <button type="button" disabled>
            尾部
          </button>
        </div>
        <p className="ip-note ip-seg-note">
          <span className="ip-todo">尚待實現</span>
          分段切換目前為視覺佔位，第一期先以完整腳本呈現。
        </p>

        <div className="ip-code" tabIndex={0} role="group" aria-label="腳本全文">
          <table>
            <tbody>
              {lines.map((line) => (
                <tr key={line.number} className={line.mid ? 'ip-mid' : undefined}>
                  <td className="ip-ln" aria-hidden="true">
                    {line.number}
                  </td>
                  <td>{line.text || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ip-legend">
          <span>
            <i className="ip-swatch ip-swatch-plat" />
            平台生成的上部與尾部，發布者不可修改
          </span>
          <span>
            <i className="ip-swatch ip-swatch-mid" />
            發布者的{data.action === 'uninstall' ? '解除安裝' : '安裝'}命令，在隔離子程序執行
          </span>
        </div>
        <p className="ip-note">
          腳本摘要 <span className="mono">{data.digest}</span>，下載後可自行比對。
        </p>
      </div>
    </section>
  );
}

/**
 * 第一期顯示空狀態。禁止以靜態分析從 installCommand 推導寫入路徑或權限：
 * bash 圖靈完備，變數展開與 eval 都能繞過分析，推導錯誤比不顯示更糟。
 * 結構化欄位見 docs/第二期需求收集.md 的 P2-3。
 */
function ImpactBlock(): ReactNode {
  return (
    <section className="ip-card">
      <div className="ip-card-h">
        <h2 className="ip-card-t">影響資源與所需權限</h2>
      </div>
      <div className="ip-card-b">
        <div className="ip-empty">
          <p className="ip-empty-t">發布者未提供此資訊</p>
          <p className="ip-empty-d">
            這份腳本會寫入哪些路徑、需要什麼權限，需由發布者在上架時聲明。
            平台不從命令內容推測，避免給出不準確的結論。
          </p>
          <p className="ip-empty-d">
            你可以展開上方的完整腳本自行檢視，或聯繫發布團隊詢問。
          </p>
        </div>
      </div>
    </section>
  );
}

function TelemetryBlock({ data }: { data: GeneratedScript }): ReactNode {
  return (
    <section className="ip-card">
      <div className="ip-card-h">
        <h2 className="ip-card-t">將上報的欄位</h2>
        <span className="ip-card-s">執行結束時送出</span>
      </div>
      <div className="ip-card-b">
        <div className="ip-tele">
          {data.preview.telemetryFields.map((field) => (
            <span key={field} className="mono">
              {field}
            </span>
          ))}
        </div>
        <p className="ip-note">
          固定 {data.preview.telemetryFields.length} 欄，不可增減。
          不收集命令輸出、檔案內容、環境變數、機器名稱或 IP。
          完整說明見<Link to="/privacy">隱私聲明</Link>。
        </p>
      </div>
    </section>
  );
}

function PreviewBody({ data }: { data: GeneratedScript }): ReactNode {
  /*
   * 這一頁的主要動作交給全站頁腳渲染。頁腳本身已是固定欄，
   * 頁面再放一條 fixed 動作列會在底部疊出兩條分隔線。
   */
  useProvideFooterAction(
    () => ({
      hint: '下載後由你自行執行。平台不代為安裝，也不會在你的機器上保留連線。',
      content: (
        <>
          <Link
            className="btn btn-ghost"
            to={`/packages/${encodeURIComponent(data.packageId)}`}
          >
            返回詳情
          </Link>
          <Button variant="primary" onClick={() => downloadScript(data)}>
            下載安裝腳本
          </Button>
        </>
      )
    }),
    [data]
  );

  return (
    <div className="ip">
      <Breadcrumb
        items={[
          { label: '技能池', to: '/' },
          { label: data.packageId, to: `/packages/${encodeURIComponent(data.packageId)}` },
          { label: '執行前預覽' }
        ]}
      />

      <h1 className="ip-h1">{data.action === 'uninstall' ? '卸載' : '安裝'}執行前預覽</h1>
      <p className="ip-sub">
        先看這份腳本會做什麼，需要時再展開完整內容逐行檢視。
      </p>
      <TargetChips data={data} />

      <WhatItDoes data={data} />
      <ScriptBlock data={data} />
      <ImpactBlock />
      <TelemetryBlock data={data} />
    </div>
  );
}

export function InstallPreviewPage(): ReactNode {
  const { packageId, version } = useParams<{
    packageId: string;
    version: string;
  }>();
  const [searchParams] = useSearchParams();
  const targetOs = searchParams.get('os') ?? '';
  const clientRuntime = searchParams.get('client') ?? '';
  const actionParam = searchParams.get('action');
  const action = actionParam === 'uninstall' ? 'uninstall' : 'install';

  const fetcher = useCallback(() => {
    if (!packageId || !version || !targetOs || !clientRuntime) {
      /*
       * 缺少目標時後端必然回 400，先在前端終止。必須拋 ApiError：
       * usePageState 只保留 ApiError 的訊息，一般 Error 會被替換成
       * 通用文案，使用者就看不到「回詳情頁重選」這個可行動的指示。
       * retryable 為 false：重試不會補上缺少的參數。
       */
      return Promise.reject(
        new ApiError({
          statusCode: 400,
          code: 'MISSING_SCRIPT_TARGET',
          message: '缺少安裝目標，請回到詳情頁重新選擇系統與 Client。',
          retryable: false
        })
      );
    }
    return generateScript(packageId, version, { targetOs, clientRuntime }, action);
  }, [action, clientRuntime, packageId, targetOs, version]);

  const { pageState, reload } = usePageState(fetcher, [
    packageId,
    version,
    targetOs,
    clientRuntime,
    action
  ]);

  return (
    <PageStateView pageState={pageState} onRetry={reload}>
      {(data) => <PreviewBody data={data} />}
    </PageStateView>
  );
}
