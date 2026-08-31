// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

interface ParsedSemanticVersion {
  core: [bigint, bigint, bigint];
  prerelease: string[];
}

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemanticVersion(value: string): ParsedSemanticVersion | undefined {
  const match = semanticVersionPattern.exec(value.trim());
  if (!match) return undefined;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    return undefined;
  }
  return {
    core: [BigInt(match[1] as string), BigInt(match[2] as string), BigInt(match[3] as string)],
    prerelease
  };
}

export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNumericText(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return compareText(normalizedLeft, normalizedRight);
}

export function compareNatural(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? [];
  const rightParts = right.match(/\d+|\D+/g) ?? [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const comparison = /^\d+$/.test(leftPart) && /^\d+$/.test(rightPart)
      ? compareNumericText(leftPart, rightPart)
      : compareText(leftPart, rightPart);
    if (comparison !== 0) return comparison;
  }
  return compareText(left, right);
}

function compareParsedSemanticVersions(
  left: ParsedSemanticVersion,
  right: ParsedSemanticVersion
): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const leftPart = left.core[index] as bigint;
    const rightPart = right.core[index] as bigint;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return compareNumericText(leftPart, rightPart);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return compareText(leftPart, rightPart);
  }
  return 0;
}

export function compareSemanticVersions(left: string, right: string): number {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  if (parsedLeft && parsedRight) {
    return compareParsedSemanticVersions(parsedLeft, parsedRight);
  }
  if (Boolean(parsedLeft) !== Boolean(parsedRight)) {
    return parsedLeft ? -1 : 1;
  }
  return compareNatural(left, right);
}
