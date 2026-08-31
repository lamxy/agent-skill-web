-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

ALTER TABLE publication_reviews
  ADD COLUMN IF NOT EXISTS package_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS version_snapshot jsonb;

UPDATE publication_reviews AS review
SET package_snapshot = COALESCE(
      review.package_snapshot,
      jsonb_build_object(
        'packageId', package.package_id,
        'type', package.type,
        'name', package.name,
        'purpose', package.purpose,
        'ownerTeam', package.owner_team,
        'category', package.category,
        'visibility', package.visibility,
        'sourceUri', package.source_uri,
        'license', package.license,
        'lifecycle', package.lifecycle,
        'createdAt', package.created_at,
        'updatedAt', package.updated_at
      )
    ),
    version_snapshot = COALESCE(
      review.version_snapshot,
      jsonb_strip_nulls(jsonb_build_object(
        'id', version.id::text,
        'packageId', version.package_id,
        'version', version.version,
        'releaseNotes', version.release_notes,
        'supportedOs', version.supported_os,
        'supportedClients', version.supported_clients,
        'lifecycle', version.lifecycle,
        'scriptDigest', version.script_digest,
        'installCommand', version.install_command,
        'uninstallCommand', version.uninstall_command,
        'hasResidualEffects', version.has_residual_effects,
        'residualDescription', version.residual_description,
        'manualCleanupSteps', version.manual_cleanup_steps,
        'authorUid', version.author_uid,
        'createdAt', version.created_at,
        'updatedAt', version.updated_at
      ))
    )
FROM packages AS package, package_versions AS version
WHERE version.package_id = package.package_id
  AND version.package_id = review.package_id
  AND version.version = review.version
  AND (
    review.package_snapshot IS NULL
    OR review.version_snapshot IS NULL
  );

UPDATE publication_reviews AS review
SET package_snapshot = COALESCE(
      review.package_snapshot,
      jsonb_build_object(
        'packageId', review.package_id,
        'type', review.package_type,
        'name', '[歷史資料] ' || review.package_id,
        'purpose', '原始套件資料已不存在，保留審核識別快照',
        'ownerTeam', review.owner_team,
        'category', review.category,
        'visibility', 'internal',
        'sourceUri', 'legacy://review/' || review.id::text,
        'license', 'unknown',
        'lifecycle', 'archived',
        'createdAt', review.created_at,
        'updatedAt', COALESCE(review.decided_at, review.created_at)
      )
    ),
    version_snapshot = COALESCE(
      review.version_snapshot,
      jsonb_build_object(
        'id', 'legacy-review-' || review.id::text,
        'packageId', review.package_id,
        'version', review.version,
        'supportedOs', '[]'::jsonb,
        'supportedClients', '[]'::jsonb,
        'lifecycle', 'review_required',
        'installCommand', '[歷史資料缺失]',
        'uninstallCommand', '[歷史資料缺失]',
        'hasResidualEffects', false,
        'authorUid', review.author_uid,
        'createdAt', review.created_at,
        'updatedAt', COALESCE(review.decided_at, review.created_at)
      )
    )
WHERE review.package_snapshot IS NULL
   OR review.version_snapshot IS NULL;

ALTER TABLE publication_reviews
  ALTER COLUMN package_snapshot SET NOT NULL,
  ALTER COLUMN version_snapshot SET NOT NULL;
