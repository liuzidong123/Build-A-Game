#!/usr/bin/env node
/*
 * 扫描 apps/games/<name>/index.html，生成 games.js（供浏览器 <script> 直接加载）
 * 与 games.json（给脚本/CI 用）。
 *
 *   node apps/games/tools/scan-games.cjs            # 生成
 *   node apps/games/tools/scan-games.cjs --check    # 校验清单是否过期（过期退出码 1）
 *   node apps/games/tools/scan-games.cjs --root D   # 指定扫描根目录
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['tools', 'tests', 'api', 'assets', 'node_modules', '.git', '.stats']);

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return null;
  }
}

function parseHtmlMeta(html, id) {
  const out = { title: id, subtitle: '', tags: [], cover: '🎮' };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) out.title = text(title[1]);
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (desc) out.subtitle = text(desc[1]);
  return out;
}

function statMtime(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch (err) {
    return 0;
  }
}

function scanGames(root) {
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !SKIP_DIRS.has(name))
    .sort();

  const games = [];
  const warnings = [];

  dirs.forEach((id) => {
    const dir = path.join(root, id);
    const indexFile = path.join(dir, 'index.html');
    if (!fs.existsSync(indexFile)) {
      warnings.push(id + '：缺少 index.html，已跳过');
      return;
    }

    let meta = {};
    const cfgFile = path.join(dir, 'game.json');
    if (fs.existsSync(cfgFile)) {
      try {
        meta = JSON.parse(readText(cfgFile) || '{}') || {};
      } catch (err) {
        warnings.push(id + '：game.json 解析失败（' + err.message + '），改用 index.html 推断');
        meta = {};
      }
    }

    const fallback = parseHtmlMeta(readText(indexFile) || '', id);
    const tags = Array.isArray(meta.tags)
      ? meta.tags.map(text).filter(Boolean).slice(0, 4)
      : fallback.tags;

    games.push({
      id,
      title: text(meta.title) || fallback.title,
      subtitle: text(meta.subtitle) || text(meta.description) || fallback.subtitle,
      description: text(meta.description) || fallback.subtitle,
      tags,
      cover: Array.from(String(meta.cover || fallback.cover)).slice(0, 2).join(''),
      accent: /^#[0-9a-f]{3,8}$/i.test(meta.accent || '') ? meta.accent : '#ffd166',
      version: text(meta.version),
      updatedAt: Math.max(statMtime(indexFile), statMtime(cfgFile))
    });
  });

  return { games, warnings };
}

function buildManifest(root, games) {
  const rel = path.relative(path.resolve(root, '..', '..'), path.resolve(root)).split(path.sep).join('/');
  return {
    generatedAt: new Date().toISOString(),
    root: rel || '.',
    count: games.length,
    games
  };
}

function renderJs(manifest) {
  return '/* 由 tools/scan-games.cjs 生成，请勿手改 */\n'
    + 'window.GAMES_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ';\n';
}

function writeManifest(root, games) {
  const manifest = buildManifest(root, games);
  const js = renderJs(manifest);
  const json = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(root, 'games.js'), js, 'utf8');
  fs.writeFileSync(path.join(root, 'games.json'), json, 'utf8');
  return manifest;
}

function main(argv) {
  const args = argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const root = rootFlag >= 0
    ? path.resolve(args[rootFlag + 1])
    : path.resolve(__dirname, '..');
  const check = args.includes('--check');

  if (!fs.existsSync(root)) {
    console.error('扫描目录不存在：' + root);
    return 2;
  }

  const { games, warnings } = scanGames(root);
  warnings.forEach((line) => console.warn('[warn] ' + line));

  if (check) {
    const current = readText(path.join(root, 'games.json'));
    const expected = JSON.stringify(buildManifest(root, games), null, 2) + '\n';
    if (!current) {
      console.error('[check] games.json 不存在，请运行 node apps/games/tools/scan-games.cjs');
      return 1;
    }
    const strip = (value) => {
      try {
        const obj = JSON.parse(value);
        delete obj.generatedAt;
        return JSON.stringify(obj);
      } catch (err) {
        return null;
      }
    };
    if (strip(current) !== strip(expected)) {
      console.error('[check] games.json 已过期，请重新运行扫描');
      return 1;
    }
    console.log('[check] games.json 与目录一致（' + games.length + ' 个游戏）');
    return 0;
  }

  const manifest = writeManifest(root, games);
  console.log('[scan] ' + manifest.root + ' → ' + manifest.count + ' 个游戏');
  games.forEach((game) => console.log('  - ' + game.id + '  ' + game.title));
  console.log('[write] games.js / games.json');
  return 0;
}

module.exports = { scanGames, buildManifest, renderJs, writeManifest, parseHtmlMeta };

if (require.main === module) {
  process.exit(main(process.argv));
}
