#!/usr/bin/env node
/**
 * SmoothFlow Production Package Builder
 * Packages extension files into clean, release-ready zip for Chrome Web Store.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('📦 Building SmoothFlow Production Package...\n');

// 1. Run validation first
try {
  execSync(`node "${path.join(__dirname, 'validate.js')}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('Build aborted due to validation failure.');
  process.exit(1);
}

// 2. Prepare dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const version = manifest.version || '1.0.0';
const zipName = `smoothflow-v${version}.zip`;
const zipPath = path.join(distDir, zipName);

// 3. Remove old zip if present
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// 4. Create ZIP archive
try {
  const cmd = `cd "${rootDir}" && zip -r "${zipPath}" manifest.json icons content popup -x "*.DS_Store*"`;
  execSync(cmd, { stdio: 'pipe' });
  const stats = fs.statSync(zipPath);
  const sizeKb = (stats.size / 1024).toFixed(1);

  console.log(`🎉 Successfully packaged: dist/${zipName} (${sizeKb} KB)`);
  console.log(`🚀 Ready for upload to Chrome Web Store Developer Dashboard!\n`);
} catch (err) {
  console.error('Failed to create ZIP package:', err.message);
  process.exit(1);
}
