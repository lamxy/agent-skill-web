// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';

import './privacy.css';

/**
 * 遙測欄位清單。必須與後端 script-generator-service.ts 的 TELEMETRY_FIELDS
 * 保持一致；PRD §2.3 定義此清單同時是隱私聲明範圍與審核判斷依據，
 * 新增欄位須重新通過隱私審核。
 */
const REPORTED_FIELDS: { field: string; purpose: string }[] = [
  { field: 'idempotency_key', purpose: '單次執行的識別碼，用於避免重複計數' },
  { field: 'package_id', purpose: '安裝的技能或工具標識' },
  { field: 'version', purpose: '安裝的技能或工具版本' },
  { field: 'user_ref', purpose: '你的員工識別；未登入時為本機產生的 UUID' },
  { field: 'user_ref_type', purpose: '識別方式為員工帳號或本機 UUID' },
  { field: 'os_type', purpose: '作業系統類型，僅記錄類別不含細版本號' },
  { field: 'client_runtime', purpose: '使用的 Client 名稱' },
  { field: 'status', purpose: '安裝或解除安裝的結果' },
  { field: 'error_code', purpose: '失敗時的結構化錯誤碼，不含錯誤訊息全文' },
  { field: 'start_time', purpose: '執行開始時間' },
  { field: 'end_time', purpose: '執行結束時間' },
  { field: 'script_version', purpose: '發布者安裝腳本的獨立版本號' },
  { field: 'options', purpose: '安裝時選擇的參數名與選擇值，最多 20 組' }
];

const NOT_COLLECTED = [
  '提示內容與業務程式碼',
  '任何憑證或密鑰',
  '完整環境變數',
  '命令輸出全文',
  '檔案路徑',
  '機器名稱與 IP 位址',
  '作業系統細版本號'
];

export function PrivacyPage(): ReactNode {
  return (
    <article className="pv">
      <h1 className="pv-h1">隱私聲明</h1>
      <p className="pv-lead">
        平台生成的一鍵安裝腳本會在執行後回報安裝結果。本頁逐欄說明回報的內容與用途，
        以及明確不收集的項目。
      </p>

      <section className="pv-sec">
        <h2 className="pv-h2">為什麼要回報</h2>
        <p>
          回報資料用於統計各技能的安裝成功率與常見失敗原因，讓發布者能修正安裝腳本。
          資料不用於個人績效評估，也不會與其他系統的資料合併分析。
        </p>
      </section>

      <section className="pv-sec">
        <h2 className="pv-h2">回報的欄位</h2>
        <div className="scroll-x">
          <table className="pv-table">
            <thead>
              <tr>
                <th>欄位</th>
                <th>用途</th>
              </tr>
            </thead>
            <tbody>
              {REPORTED_FIELDS.map((row) => (
                <tr key={row.field}>
                  <td className="mono">{row.field}</td>
                  <td>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pv-note">
          此清單是完整範圍。新增欄位須重新通過隱私審核後才會生效。
        </p>
        <p className="pv-note">
          <code className="mono">options</code> 只回報發布者預先宣告、且你在安裝時選擇的參數；
          不會回報其他環境變數、命令輸出或檔案內容。
          這些選擇屬使用行為資料，只用於分析各選項下的安裝結果。
        </p>
      </section>

      <section className="pv-sec">
        <h2 className="pv-h2">明確不收集</h2>
        <ul className="pv-list">
          {NOT_COLLECTED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="pv-sec">
        <h2 className="pv-h2">未登入時的識別方式</h2>
        <p>
          未登入時，腳本會在你的機器上產生一組隨機 UUID 並保存，
          同一台機器重複安裝沿用同一組。平台無法由此 UUID 反查真實身份。
        </p>
        <p>UUID 的存放位置依作業系統而定：</p>
        <ul className="pv-list">
          <li>
            Linux、macOS 與 WSL：<code className="mono">~/.agent-platform/uuid</code>
          </li>
          <li>
            Windows：<code className="mono">%APPDATA%\agent-platform\uuid</code>
          </li>
        </ul>
        <p>
          刪除該檔案會在下次執行時產生新的 UUID，並被視為新的使用者。
          已登入與未登入的安裝在統計中分層呈現，不合併為單一成功率。
        </p>
      </section>

      <section className="pv-sec">
        <h2 className="pv-h2">回報的可靠性</h2>
        <p>
          回報機制為盡力而為。腳本在離線時會把結果排入本機佇列，下次執行時補交；
          但平台無法保證每次執行都被記錄，統計數據僅供參考。
        </p>
      </section>
    </article>
  );
}
