// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/**
 * 平台版本。記錄平台自身的發布歷程，以及每個版本目前是否開放使用，
 * 讓前端的版本選單不必把「哪些版本存在、哪個能用」寫死在程式碼裡。
 */
export interface PlatformVersionRecord {
  /** 版本號，同時作為業務主鍵，例如 v0.0.1 */
  version: string;
  /** 是否開放使用。未開放的版本仍會列出，但標示為暫未開放 */
  isAvailable: boolean;
  /** 是否為目前預設載入的版本；全表至多一筆為真 */
  isCurrent: boolean;
  /** 版本說明，未開放時用來交代預計開放時程或原因 */
  note: string | null;
  /** 發布時間；尚未發布的規劃中版本為 null */
  releasedAt: string | null;
  /** 版本清單的排序值，數字大的排在前面（新版本在上） */
  displayOrder: number;
}
