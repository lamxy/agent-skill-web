/**
 * 為原始碼檔案補上版權與授權標頭。
 *
 * 冪等：已含 SPDX-License-Identifier 的檔案直接跳過，可重複執行。
 * 帶 --check 時只回報缺少標頭的檔案並以非零碼結束，適合接在 CI 上。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** 只掃這幾個目錄，避開 node_modules、dist 與各種工具的暫存目錄 */
const TARGET_DIRS = ['src', 'web/src', 'test', 'scripts', 'drizzle'];

const LINES = [
  'Copyright (c) 2026 lamxy and Contributors',
  'SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0',
  '',
  'Author: lamxy <pytho5170@hotmail.com>',
  'GitHub: https://github.com/lamxy'
];

/** 各語言的行註釋前綴；副檔名不在表內就不處理 */
const COMMENT_PREFIX: Record<string, string> = {
  '.ts': '//',
  '.tsx': '//',
  '.mts': '//',
  '.cts': '//',
  '.js': '//',
  '.jsx': '//',
  '.css': '/*',
  '.sql': '--'
};

function renderHeader(ext: string): string {
  const prefix = COMMENT_PREFIX[ext];
  if (prefix === '/*') {
    // CSS 沒有行註釋，整段包成一個區塊註釋
    return ['/*', ...LINES.map((line) => (line ? ` * ${line}` : ' *')), ' */'].join('\n');
  }
  return LINES.map((line) => (line ? `${prefix} ${line}` : prefix)).join('\n');
}

async function collect(dir: string, found: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // 目錄不存在就略過，不讓腳本因此失敗
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await collect(full, found);
    } else if (extname(entry.name) in COMMENT_PREFIX) {
      found.push(full);
    }
  }
  return found;
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const files: string[] = [];
  for (const dir of TARGET_DIRS) {
    await collect(join(ROOT, dir), files);
  }

  const missing: string[] = [];
  let written = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    if (content.includes('SPDX-License-Identifier')) continue;

    missing.push(relative(ROOT, file));
    if (checkOnly) continue;

    /*
     * shebang 必須留在第一行，否則腳本無法直接執行，
     * 因此標頭插在 shebang 之後而非檔案最前面。
     */
    const header = renderHeader(extname(file));
    const hasShebang = content.startsWith('#!');
    if (hasShebang) {
      const breakAt = content.indexOf('\n');
      const shebang = content.slice(0, breakAt);
      const rest = content.slice(breakAt + 1).replace(/^\n+/, '');
      await writeFile(file, `${shebang}\n${header}\n\n${rest}`, 'utf8');
    } else {
      await writeFile(file, `${header}\n\n${content.replace(/^\n+/, '')}`, 'utf8');
    }
    written += 1;
  }

  if (checkOnly) {
    if (missing.length > 0) {
      console.error(`缺少授權標頭的檔案共 ${missing.length} 個：`);
      for (const file of missing) console.error(`  ${file}`);
      process.exitCode = 1;
      return;
    }
    console.log(`已檢查 ${files.length} 個檔案，全部含授權標頭。`);
    return;
  }

  console.log(`已掃描 ${files.length} 個檔案，補上標頭 ${written} 個。`);
}

await main();
