// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { ReactNode } from 'react';
import { Link } from 'react-router';

import './breadcrumb.css';

/**
 * 麵包屑的單層。有 to 就是可點的上層節點，沒有就是當前頁（最後一層）。
 */
export type Crumb = {
  label: string;
  to?: string;
};

/**
 * 全站共用麵包屑。原本各頁自行拼 Link 與分隔符，樣式與分隔符各不相同，
 * 集中到這裡後層級表達一致，也讓當前頁固定標為 aria-current。
 */
export function Breadcrumb({ items }: { items: Crumb[] }): ReactNode {
  return (
    <nav className="crumb" aria-label="麵包屑">
      {items.map((item, index) => (
        <span className="crumb-item" key={`${item.label}-${index}`}>
          {index > 0 ? <span className="crumb-sep" aria-hidden="true">／</span> : null}
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
