// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { fetchSupportChannels } from '../api/experience.js';
import type { SupportChannel } from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { PageStateView } from '../components/PageStateView.js';
import { Chip } from '../components/primitives.js';
import { SUPPORT_CHANNEL_LABEL } from './experience-model.js';
import './support-channels.css';

/**
 * 位址可能是網址、信箱或純文字群組名稱。只有前兩者能安全地做成連結；
 * 其餘原樣顯示，不猜測協定也不自行補上 https。
 */
function ChannelAddress({ channel }: { channel: SupportChannel }): ReactNode {
  const address = channel.address;
  if (/^https?:\/\//i.test(address)) {
    return (
      <a className="mono" href={address} target="_blank" rel="noreferrer noopener">
        {address}
      </a>
    );
  }
  if (channel.channelType === 'email' && address.includes('@')) {
    return (
      <a className="mono" href={`mailto:${address}`}>
        {address}
      </a>
    );
  }
  return <span className="mono sc-plain">{address}</span>;
}

function ChannelList({ channels }: { channels: SupportChannel[] }): ReactNode {
  return (
    <>
      <ul className="sc-list">
        {channels.map((channel) => (
          <li key={channel.id}>
            <div className="sc-line">
              <strong>{channel.label}</strong>
              <Chip tone="neutral">{SUPPORT_CHANNEL_LABEL[channel.channelType]}</Chip>
            </div>
            <ChannelAddress channel={channel} />
            {channel.instructions ? (
              <p className="sc-note">{channel.instructions}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="sc-rule">
        支援入口對所有能看到此套件的人開放，包含尚未登入的訪客。遇到問題的人需要能直接找到人。
      </p>
    </>
  );
}

export function SupportChannelsSection({
  packageId
}: {
  packageId: string;
}): ReactNode {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchSupportChannels(packageId, signal),
    [packageId]
  );
  const { pageState, reload } = usePageState(fetcher, [packageId], {
    isEmpty: (items) => items.length === 0,
    // 空狀態本身有作用：推動維護者補齊，也讓審核者看得出誰沒填。
    emptyMessage: '維護者尚未設定支援渠道；此套件目前沒有可用的求助入口。'
  });

  return (
    <section className="pd-card sc">
      <h2 className="pd-card-h">遇到問題找誰</h2>
      <PageStateView pageState={pageState} onRetry={reload}>
        {(channels) => <ChannelList channels={channels} />}
      </PageStateView>
    </section>
  );
}
