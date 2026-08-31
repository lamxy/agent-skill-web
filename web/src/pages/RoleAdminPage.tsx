// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { useCallback, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import {
  fetchReviewerCandidates,
  fetchUserRoles,
  grantRole,
  revokeRole
} from '../api/admin.js';
import type {
  GrantableRole,
  ReviewerCandidate,
  RoleAssignment
} from '../api/types.js';
import { usePageState } from '../api/use-page-state.js';
import { FieldHelp } from '../components/FieldHelp.js';
import { PageStateView } from '../components/PageStateView.js';
import { Select } from '../components/Select.js';
import { Button, Chip } from '../components/primitives.js';
import { AdminHeader } from './AdminNav.js';
import {
  availableRolesToGrant,
  describeRoleFailure,
  grantableRoleMeta,
  manageableRoles,
  readOnlyRoles,
  reviewerCandidateOptions
} from './admin-model.js';
import './admin.css';

const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function RoleRow({
  assignment,
  revoking,
  onRevoke
}: {
  assignment: RoleAssignment;
  revoking: boolean;
  onRevoke: (assignment: RoleAssignment) => void;
}): ReactNode {
  const meta = grantableRoleMeta(assignment.role as GrantableRole);
  return (
    <tr>
      <td>
        <strong>{assignment.role}</strong>
        {meta ? <small className="adm-role-summary">{meta.summary}</small> : null}
      </td>
      <td className="mono">{assignment.assignedByUid}</td>
      <td>{dateFormatter.format(new Date(assignment.createdAt))}</td>
      <td className="adm-action">
        <Button
          variant="danger"
          disabled={revoking}
          onClick={() => onRevoke(assignment)}
        >
          {revoking ? '撤銷中…' : '撤銷'}
        </Button>
      </td>
    </tr>
  );
}

function RoleConsole({
  uid,
  displayName,
  teamIds
}: {
  uid: string;
  displayName: string;
  teamIds: string[];
}): ReactNode {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchUserRoles(uid, signal),
    [uid]
  );
  const { pageState, reload } = usePageState(fetcher, [uid]);
  const [mutationError, setMutationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revokingRole, setRevokingRole] = useState('');
  const [roleDraft, setRoleDraft] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // 自訂下拉不是原生表單控制項，值取自 state 而非 FormData。
    const role = roleDraft as GrantableRole;
    if (!role) return;
    setSaving(true);
    setMutationError('');
    /*
     * 收斂後兩種角色都是全平台生效，因此固定送 global 且不帶 scopeValue。
     * 後端 CHECK 約束要求 global 不得有範圍值，送空字串會被擋下。
     */
    void grantRole({ uid, role, scopeType: 'global' })
      .then(() => {
        setRoleDraft('');
        reload();
      })
      .catch((error: unknown) => setMutationError(describeRoleFailure(error)))
      .finally(() => setSaving(false));
  };

  const revoke = useCallback(
    (assignment: RoleAssignment) => {
      const meta = grantableRoleMeta(assignment.role as GrantableRole);
      const effect = meta ? `\n\n${meta.revokeEffect}` : '';
      if (!window.confirm(`確定撤銷 ${displayName} 的 ${assignment.role} 角色？${effect}`)) {
        return;
      }
      setRevokingRole(assignment.role);
      setMutationError('');
      void revokeRole({ uid, role: assignment.role as GrantableRole })
        .then(() => reload())
        .catch((error: unknown) => setMutationError(describeRoleFailure(error)))
        .finally(() => setRevokingRole(''));
    },
    [displayName, reload, uid]
  );

  return (
    <>
      <PageStateView pageState={pageState} onRetry={reload}>
        {(assignments) => {
          const manageable = manageableRoles(assignments);
          const readOnly = readOnlyRoles(assignments);
          const grantable = availableRolesToGrant(assignments);
          return (
            <>
              <form className="adm-form adm-role-form" onSubmit={submit}>
                <label>
                  <span className="label-text">
                    授予角色
                    <FieldHelp>
                      角色沒有範圍，授予後全平台生效。一般員工不需授予任何角色，
                      本來就能發布與更新自己團隊（{teamIds.join('、') || '未分組'}）的技能。
                    </FieldHelp>
                  </span>
                  <Select
                    value={roleDraft}
                    onChange={setRoleDraft}
                    disabled={grantable.length === 0}
                    placeholder={grantable.length === 0 ? '兩種角色都已授予' : '選擇要授予的角色'}
                    options={grantable.map((item) => ({
                      value: item.role,
                      label: `${item.label} — ${item.summary}`
                    }))}
                  />
                </label>
                {/* 自訂下拉沒有原生 required，必填改由送出鍵的可用狀態把關 */}
                <Button type="submit" variant="primary" disabled={saving || grantable.length === 0 || !roleDraft}>
                  {saving ? '授予中…' : '授予角色'}
                </Button>
              </form>
              {mutationError ? (
                <p className="adm-error" role="alert">
                  {mutationError}
                </p>
              ) : null}

              <section className="adm-panel" aria-label="目前角色">
                {manageable.length === 0 ? (
                  <div className="adm-start-state">
                    <strong>這位使用者目前沒有額外角色</strong>
                    <p>
                      他仍然可以瀏覽技能池、安裝技能，並發布與更新自己團隊的技能——
                      這些不需要任何角色。只有需要跨團隊更新或審核時才授予角色。
                    </p>
                  </div>
                ) : (
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>角色</th>
                        <th>授予者</th>
                        <th>授予時間</th>
                        <th>
                          <span className="sr-only">操作</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {manageable.map((assignment) => (
                        <RoleRow
                          key={assignment.id}
                          assignment={assignment}
                          revoking={revokingRole === assignment.role}
                          onRevoke={revoke}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
                {/*
                  platform_admin 唯讀呈現：此頁撤銷不了它，混進可撤銷的清單
                  會讓管理員以為點得動；完全不顯示又會讓人以為這個人沒有權限。
                */}
                {readOnly.length > 0 ? (
                  <p className="adm-role-readonly">
                    <Chip tone="seal">platform_admin</Chip>
                    此使用者是平台管理員。該角色由部署設定指定，不能在此撤銷——
                    否則撤掉最後一位管理員，平台會永久失去授權能力。
                  </p>
                ) : null}
              </section>
            </>
          );
        }}
      </PageStateView>
    </>
  );
}

export function RoleAdminPage(): ReactNode {
  const [selected, setSelected] = useState<ReviewerCandidate>();
  const [uidDraft, setUidDraft] = useState('');
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchReviewerCandidates(signal),
    []
  );
  const { pageState, reload } = usePageState(fetcher, [], {
    isEmpty: (items) => items.length === 0,
    emptyMessage: '目前沒有可管理的身份。使用者必須先從 SSO 登入一次才會出現。'
  });

  return (
    <div className="adm">
      <AdminHeader
        title="角色管理"
        description="授予與撤銷 maintainer 與 reviewer。一般員工不需角色，本來就能維護自己團隊的技能；平台管理員不在此授予。"
      />

      <PageStateView pageState={pageState} onRetry={reload}>
        {(candidates) => (
          <form
            className="adm-locate"
            onSubmit={(event) => {
              event.preventDefault();
              setSelected(candidates.find((item) => item.uid === uidDraft));
            }}
          >
            <label>
              <span className="label-text">使用者</span>
              <Select
                value={uidDraft}
                onChange={setUidDraft}
                placeholder="選擇有效使用者"
                options={reviewerCandidateOptions(candidates)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={!uidDraft}>
              查詢角色
            </Button>
          </form>
        )}
      </PageStateView>

      {selected ? (
        <RoleConsole
          key={selected.uid}
          uid={selected.uid}
          displayName={selected.displayName}
          teamIds={selected.teamIds}
        />
      ) : (
        <div className="adm-start-state">
          <strong>先選擇一位使用者</strong>
          <p>
            角色查詢一次針對一位使用者。平台沒有「列出所有角色指派」的端點，
            因此這裡不提供全平台總覽。
          </p>
        </div>
      )}
    </div>
  );
}
