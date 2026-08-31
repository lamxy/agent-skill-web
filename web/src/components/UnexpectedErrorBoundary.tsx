// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  hasError: boolean;
}

export class UnexpectedErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('頁面發生未預期錯誤', error, info.componentStack);
    }
  }

  componentDidUpdate(previousProps: Props): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="shell-error" role="alert" aria-labelledby="shell-error-title">
        <h1 id="shell-error-title">頁面暫時無法顯示</h1>
        <p>發生未預期的錯誤。你可以重試，或使用上方導覽前往其他頁面。</p>
        <button type="button" onClick={this.retry}>重新嘗試</button>
      </section>
    );
  }
}
