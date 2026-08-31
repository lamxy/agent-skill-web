// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useEffect, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { startLogin } from '../api/identity.js';
import { useViewer } from '../api/viewer-context.js';
import './login.css';

/** 只接受站內路徑，避免登入流程被用來轉導至外部站點。 */
function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { viewer, loading, failed } = useViewer();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  // 已登入者不該停在登入頁；直接送回原本要去的地方。
  useEffect(() => {
    if (viewer?.kind === 'authenticated') {
      void navigate(returnTo, { replace: true });
    }
  }, [viewer, returnTo, navigate]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Agent 技能平台</h1>
        <p className="login-lead">企業內部技能與 Agent 分發平台</p>

        {failed ? (
          <div className="login-alert" role="alert">
            <strong>目前無法登入</strong>
            <p>
              身份服務暫時無法使用，請稍後再試；持續發生時請聯絡平台管理員。
            </p>
          </div>
        ) : null}

        <button
          type="button"
          className="login-action"
          disabled={loading}
          onClick={() => startLogin(returnTo)}
        >
          {loading ? '確認登入狀態…' : '使用公司帳號登入'}
        </button>

        <p className="login-hint">
          將轉導至公司單一登入頁完成驗證。平台不會接觸您的密碼。
        </p>
      </div>
    </div>
  );
}
