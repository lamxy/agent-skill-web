// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { roleLabel, scopeLabel, startLogin } from '../api/identity.js';
import { useTheme, type ThemePreference } from '../api/theme-context.js';
import { useViewer } from '../api/viewer-context.js';
import {
  ChevronRightIcon,
  InstallIcon,
  LanguageIcon,
  LogoutIcon,
  MoonIcon,
  RoleIcon,
  SunIcon,
  SystemThemeIcon,
  TeamIcon,
  ThemeIcon,
  UserIcon
} from './icons.js';
import './viewer-menu.css';

/**
 * 三選一而非開關：「跟隨系統」與「明確選淺色」在行為上不同，
 * 用開關表達會讓跟隨系統的人無法回到跟隨狀態。
 */
const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: () => ReactNode;
}[] = [
  { value: 'light', label: '白天', icon: () => <SunIcon /> },
  { value: 'dark', label: '夜晚', icon: () => <MoonIcon /> },
  { value: 'system', label: '跟隨系統', icon: () => <SystemThemeIcon /> }
];

function ThemeSwitch(): ReactNode {
  const { preference, setPreference } = useTheme();

  return (
    <div className="viewer-theme">
      <span className="viewer-theme-label" id="viewer-theme-label">
        <ThemeIcon />
        瀏覽樣式
      </span>
      <div
        className="viewer-theme-options"
        role="group"
        aria-labelledby="viewer-theme-label"
      >
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={preference === option.value}
            data-active={preference === option.value ? '' : undefined}
            onClick={() => setPreference(option.value)}
          >
            {option.icon()}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ViewerMenu(): ReactNode {
  const { viewer, loading, logout } = useViewer();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const returnTo = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // 身份解析完成前不顯示登入鍵，避免已登入者看到一次錯誤狀態閃動。
  if (loading) {
    return <span className="viewer-placeholder" aria-hidden="true" />;
  }

  if (viewer?.kind !== 'authenticated') {
    return (
      <button
        type="button"
        className="viewer-login"
        onClick={() => startLogin(returnTo)}
      >
        <UserIcon />
        使用公司帳號登入
      </button>
    );
  }

  // 平台沒有個人上傳的頭像，一律使用預設人像圖標；
  // 姓名已在圖標旁完整顯示，再取首字只是重複同一份資訊。
  const avatar = (
    <span className="viewer-avatar" aria-hidden="true">
      <UserIcon className="viewer-avatar-icon" />
    </span>
  );

  return (
    <div className="viewer-menu" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="viewer-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {avatar}
        <span className="viewer-name">{viewer.displayName}</span>
      </button>

      {open ? (
        <div className="viewer-panel" role="menu">
          <div className="viewer-panel-head">
            {avatar}
            <div>
              <p className="viewer-panel-name">{viewer.displayName}</p>
              <p className="viewer-panel-uid">{viewer.uid}</p>
            </div>
          </div>

          <dl className="viewer-facts">
            <dt>
              <TeamIcon />
              團隊
            </dt>
            <dd>
              {viewer.teamIds.length > 0 ? viewer.teamIds.join('、') : '未指定'}
            </dd>
            <dt>
              <RoleIcon />
              角色
            </dt>
            <dd className={viewer.roles.length > 0 ? 'viewer-roles-cell' : ''}>
              {viewer.roles.length > 0 ? (
                <ul className="viewer-roles">
                  {viewer.roles.map((entry) => (
                    <li key={`${entry.role}-${entry.scopeType}-${entry.scopeValue}`}>
                      <span className="viewer-role">{roleLabel(entry.role)}</span>
                      <span className="viewer-scope">
                        {scopeLabel(entry.scopeType, entry.scopeValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                // 沒有角色不是錯誤：一般員工本就只有瀏覽與安裝權限。
                '一般員工權限，可瀏覽與安裝技能'
              )}
            </dd>
          </dl>

          <ThemeSwitch />

          <div className="viewer-actions">
            {/*
              語言切換尚未開放。用 disabled 而非隱藏：讓使用者知道這個能力
              在規劃中，右側箭頭表示點開後還有下一層可選。
            */}
            <button
              type="button"
              role="menuitem"
              className="viewer-locked"
              disabled
              title="暫未開放"
            >
              <LanguageIcon />
              切換語言
              <span className="viewer-locked-note">暫未開放</span>
              <ChevronRightIcon className="viewer-locked-arrow" />
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void navigate('/me/installations');
              }}
            >
              <InstallIcon />
              我的安裝
            </button>
            <button
              type="button"
              role="menuitem"
              className="viewer-logout"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              <LogoutIcon />
              登出
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
