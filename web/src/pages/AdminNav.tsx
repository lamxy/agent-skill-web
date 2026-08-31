// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

import { AdminIcon } from '../components/icons.js';

export function AdminNav(): ReactNode {
  return (
    <nav className="adm-tabs" aria-label="管理後台">
      <NavLink to="/admin/reviewers">審核者管理</NavLink>
      <NavLink to="/admin/roles">角色管理</NavLink>
      <NavLink to="/admin/versions">版本治理</NavLink>
      <NavLink to="/admin/support">支援與反饋</NavLink>
      <NavLink to="/admin/audit">稽核日誌</NavLink>
    </nav>
  );
}

export function AdminHeader({
  title,
  description
}: {
  title: string;
  description: string;
}): ReactNode {
  return (
    <>
      <AdminNav />
      <header className="adm-head">
        <div>
          <h1>
            <AdminIcon className="page-title-icon" />
            {title}
          </h1>
          <p>{description}</p>
        </div>
      </header>
    </>
  );
}
