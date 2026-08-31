// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';

import { CatalogPage } from './pages/CatalogPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { InstallPreviewPage } from './pages/InstallPreviewPage.js';
import { PackageDetailPage } from './pages/PackageDetailPage.js';
import { PrivacyPage } from './pages/PrivacyPage.js';
import { ReviewsPage } from './pages/ReviewsPage.js';
import { ReviewDetailPage } from './pages/ReviewDetailPage.js';
import { ReviewerAdminPage } from './pages/ReviewerAdminPage.js';
import { RoleAdminPage } from './pages/RoleAdminPage.js';
import { VersionGovernancePage } from './pages/VersionGovernancePage.js';
import { AuditLogsPage } from './pages/AuditLogsPage.js';
import { MyInstallationsPage } from './pages/MyInstallationsPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { PackageSupportAdminPage } from './pages/PackageSupportAdminPage.js';
import { CreatePackagePage } from './pages/CreatePackagePage.js';
import { MaintainedPackagesPage } from './pages/MaintainedPackagesPage.js';
import { PublishPage } from './pages/PublishPage.js';
import { VersionDiffPage } from './pages/VersionDiffPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { PlatformVersionMenu } from './components/PlatformVersionMenu.js';
import { UnexpectedErrorBoundary } from './components/UnexpectedErrorBoundary.js';
import { BellIcon } from './components/icons.js';
import { ViewerMenu } from './components/ViewerMenu.js';
import { canReview, isAuthenticated, isPlatformAdmin } from './api/identity.js';
import {
  FooterActionProvider,
  useFooterAction
} from './api/footer-action-context.js';
import { ThemeProvider } from './api/theme-context.js';
import { ViewerProvider, useViewer } from './api/viewer-context.js';
import './app.css';

/**
 * 平台標記。三塊模組疊成一個方形：底部是承載技能的平台，
 * 上方兩塊是可插拔的技能單元，右上留缺口表示「還能再裝一個」。
 * 全部使用 currentColor，日夜主題各自沿用文字色，不需要兩套資源。
 */
function BrandMark(): ReactNode {
  return (
    <svg
      className="shell-logo"
      viewBox="0 0 28 28"
      role="img"
      aria-label="Agent 技能平台標記"
    >
      <rect x="3" y="16" width="22" height="9" rx="2.5" fill="currentColor" />
      <rect x="3" y="3" width="9" height="9" rx="2.5" fill="currentColor" />
      <rect
        x="16"
        y="3"
        width="9"
        height="9"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="3.2 2.4"
      />
    </svg>
  );
}

/** 頁面尚未實作時的佔位，避免路由指向空白畫面 */
function Placeholder({ title }: { title: string }): ReactNode {
  return (
    <div className="placeholder">
      <h1>{title}</h1>
      <p>此頁面尚未實作。</p>
    </div>
  );
}

/**
 * 導覽只依角色決定入口的可見性，不構成安全邊界——真正的授權判定
 * 一律在後端執行。此處隱藏入口是為了不讓員工點進必然被拒的頁面。
 */
function ShellNav(): ReactNode {
  const { viewer } = useViewer();
  const signedIn = isAuthenticated(viewer);

  return (
    <nav className="shell-nav" aria-label="主要導覽">
      <NavLink to="/">技能池</NavLink>
      {signedIn ? <NavLink to="/me/installations">我的安裝</NavLink> : null}
      {signedIn ? <NavLink to="/publish">技能維護</NavLink> : null}
      {canReview(viewer) ? <NavLink to="/reviews">審核</NavLink> : null}
      {isPlatformAdmin(viewer) ? <NavLink to="/admin/reviewers">管理</NavLink> : null}
    </nav>
  );
}

/**
 * 通知以圖標呈現並固定在頂欄右側、緊鄰身份選單，符合員工對「鈴鐺在右上角」
 * 的既有預期；未登入者沒有通知可看，因此不顯示入口。
 */
function NotificationsLink(): ReactNode {
  const { viewer } = useViewer();
  if (!isAuthenticated(viewer)) return null;

  return (
    <NavLink to="/me/notifications" className="shell-icon-link" title="通知" aria-label="通知">
      <BellIcon />
    </NavLink>
  );
}

/**
 * 頁腳。除固定的平台資訊外，還負責渲染各頁投遞過來的主要動作，
 * 讓全站底部只有這一條固定欄，不會與頁面自帶的動作列疊出兩條分隔線。
 */
export function ShellFooter(): ReactNode {
  const action = useFooterAction();

  /*
   * 有動作的頁面整條頁腳讓給該動作：平台資訊與隱私聲明是全站兜底內容，
   * 與當頁的主要操作並排只會分散視線，也會在窄屏擠成兩行。
   */
  if (action) {
    return (
      <footer className="shell-foot" data-with-action="">
        {action.hint ? (
          <span className="shell-foot-hint">{action.hint}</span>
        ) : null}
        <div className="shell-foot-action">{action.content}</div>
      </footer>
    );
  }

  return (
    <footer className="shell-foot">
      <span>
        Agent 技能平台 · 企業內部使用 · <NavLink to="/privacy">隱私聲明</NavLink>
      </span>
    </footer>
  );
}

function AppShell(): ReactNode {
  const location = useLocation();

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">跳至主要內容</a>
      <header className="shell-top">
        <NavLink to="/" className="shell-brand">
          <BrandMark />
          <span className="shell-brand-name">
            Agent 技能平台
            {/* 提醒這是最小驗證產品，功能與資料都可能再變動 */}
            <sup className="shell-mvp" title="最小可行產品，功能與資料可能變動">
              MVP
            </sup>
          </span>
        </NavLink>
        <ShellNav />
        <div className="shell-actions">
          <PlatformVersionMenu />
          <NotificationsLink />
          <ViewerMenu />
        </div>
      </header>

      <main id="main-content" className="shell-main" tabIndex={-1}>
        <UnexpectedErrorBoundary resetKey={location.key}>
          <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/packages/:packageId" element={<PackageDetailPage />} />
          <Route
            path="/packages/:packageId/analytics"
            element={<AnalyticsPage />}
          />
          <Route
            path="/packages/:packageId/versions/:version/install"
            element={<InstallPreviewPage />}
          />
          {/* /publish/new 必須在 /publish/:packageId 之前，否則 new 會被當成識別碼 */}
          <Route path="/publish" element={<MaintainedPackagesPage />} />
          <Route path="/publish/new" element={<CreatePackagePage />} />
          <Route path="/publish/:packageId" element={<PublishPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route
            path="/reviews/:reviewId"
            element={<ReviewDetailPage />}
          />
          <Route
            path="/packages/:packageId/versions/:version/diff/:targetVersion"
            element={<VersionDiffPage />}
          />
          <Route path="/me/installations" element={<MyInstallationsPage />} />
          <Route path="/me/notifications" element={<NotificationsPage />} />
          <Route path="/admin/reviewers" element={<ReviewerAdminPage />} />
          <Route path="/admin/roles" element={<RoleAdminPage />} />
          <Route path="/admin/versions" element={<VersionGovernancePage />} />
          <Route path="/admin/support" element={<PackageSupportAdminPage />} />
          <Route path="/admin/audit" element={<AuditLogsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Placeholder title="找不到頁面" />} />
          </Routes>
        </UnexpectedErrorBoundary>
      </main>

      <ShellFooter />
    </div>
  );
}

export function App(): ReactNode {
  return (
    <ThemeProvider>
      <ViewerProvider>
        <FooterActionProvider>
          <AppShell />
        </FooterActionProvider>
      </ViewerProvider>
    </ThemeProvider>
  );
}
