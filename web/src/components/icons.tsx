// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';

/**
 * 全站共用圖標。統一為 24×24 線性單色，一律以 currentColor 上色，
 * 因此日夜主題與各種文字色都直接沿用父層顏色，不需要多套資源。
 *
 * 圖標一律標記 aria-hidden：本專案的圖標都與可見文字並列出現，
 * 讓螢幕閱讀器再讀一次只會造成重複。獨立成為唯一內容時，
 * 由呼叫端在可點擊元素上補 aria-label。
 */
function Icon({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

/** 技能池：堆疊的方塊，呼應可挑選的技能集合 */
export function CatalogIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M12 3 21 7.5 12 12 3 7.5 12 3Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17 12 21.5 21 17" />
    </Icon>
  );
}

/** 我的安裝：向下箭頭落入托盤，表示已裝進本機 */
export function InstallIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M12 3v10" />
      <path d="m8 9.5 4 4 4-4" />
      <path d="M4 16v3.5h16V16" />
    </Icon>
  );
}

/** 技能維護：扳手，表示由自己維護的技能 */
export function MaintainIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M15.5 3.5a5.5 5.5 0 0 0-6.9 6.9L3.6 15.4a2 2 0 0 0 0 2.8l2.2 2.2a2 2 0 0 0 2.8 0l5-5a5.5 5.5 0 0 0 6.9-6.9L17 11 13 7l2.5-3.5Z" />
    </Icon>
  );
}

/** 審核：核取記號置於盾牌內，表示把關 */
export function ReviewIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M12 2.8 20 5.5v6c0 4.6-3.2 8.4-8 9.7-4.8-1.3-8-5.1-8-9.7v-6L12 2.8Z" />
      <path d="m8.8 11.8 2.3 2.3 4.1-4.4" />
    </Icon>
  );
}

/** 管理：滑桿，表示平台層級的設定與治理 */
export function AdminIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="10" cy="17" r="2.2" />
    </Icon>
  );
}

/** 通知：鈴鐺 */
export function BellIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2l-1.3 2.6a1 1 0 0 0 .9 1.45h11.8a1 1 0 0 0 .9-1.45l-1.3-2.6V8.5A5.5 5.5 0 0 0 12 3Z" />
      <path d="M9.8 18.2a2.3 2.3 0 0 0 4.4 0" />
    </Icon>
  );
}

/** 使用者：預設頭像。未設定個人圖像時的通用替代 */
export function UserIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle cx="12" cy="8.5" r="3.7" />
      <path d="M4.8 20a7.6 7.6 0 0 1 14.4 0" />
    </Icon>
  );
}

/** 登出：箭頭離開框體 */
export function LogoutIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M10 8.5 6 12l4 3.5" />
      <path d="M6 12h9" />
    </Icon>
  );
}

/** 隱私聲明：鎖，表示資料保護 */
export function PrivacyIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </Icon>
  );
}

/** 團隊：兩個並排的人像 */
export function TeamIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.2 19a6 6 0 0 1 11.6 0" />
      <path d="M16.2 5.6a3.2 3.2 0 0 1 0 5.9" />
      <path d="M17.6 14a6 6 0 0 1 3.2 5" />
    </Icon>
  );
}

/** 角色：識別證，表示被授予的身份 */
export function RoleIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16.2a3.4 3.4 0 0 1 6 0" />
      <path d="M14.5 10h4M14.5 13.5h4" />
    </Icon>
  );
}

/** 瀏覽樣式：調色盤 */
export function ThemeIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.15-.75-.4-1-.25-.26-.4-.6-.4-1 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.14-4.03-7-9-7Z" />
      <circle cx="7.7" cy="11.5" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7.8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="9.3" r="1.05" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** 白天：太陽 */
export function SunIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </Icon>
  );
}

/** 夜晚：月亮 */
export function MoonIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
    </Icon>
  );
}

/** 跟隨系統：顯示器 */
export function SystemThemeIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </Icon>
  );
}

/** 切換語言：地球，通用的語言／地區符號 */
export function LanguageIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </Icon>
  );
}

/** 次選單指示：向右的角括號 */
export function ChevronRightIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <path d="m9.5 5 6.5 7-6.5 7" />
    </Icon>
  );
}

/** 搜尋：放大鏡 */
export function SearchIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.6 4.6" />
    </Icon>
  );
}

/** 發布技能：加號置於方框，表示新增一個技能 */
export function PublishIcon({ className }: IconProps): ReactNode {
  return (
    <Icon {...(className ? { className } : {})}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 8.5v7" />
      <path d="M8.5 12h7" />
    </Icon>
  );
}
