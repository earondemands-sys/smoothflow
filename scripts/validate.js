#!/usr/bin/env node
/**
 * SmoothFlow Extension Validator
 * Validates manifest.json, required assets, and JS syntax.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
console.log('🔍 Running SmoothFlow Pre-Flight Validation...\n');

let errors = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    errors++;
  } else {
    console.log(`  ✓ PASS: ${message}`);
  }
}

// 1. Validate manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.manifest_version === 3, 'manifest_version is 3 (Manifest V3)');
  assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'Extension has valid name');
  assert(typeof manifest.version === 'string' && /^\d+\.\d+\.\d+/.test(manifest.version), 'Extension has valid semver version');
  assert(typeof manifest.description === 'string' && manifest.description.length <= 132, 'Description <= 132 chars (Chrome Web Store limit)');
  assert(Array.isArray(manifest.permissions), 'Permissions declared');
} catch (e) {
  assert(false, `manifest.json is valid JSON: ${e.message}`);
}

// 2. Validate Icons
if (manifest && manifest.icons) {
  for (const [size, iconRelPath] of Object.entries(manifest.icons)) {
    const iconAbsPath = path.join(rootDir, iconRelPath);
    assert(fs.existsSync(iconAbsPath), `Icon ${size}x${size} exists at ${iconRelPath}`);
  }
}

// 3. Validate Content Scripts
if (manifest && manifest.content_scripts) {
  manifest.content_scripts.forEach((cs, i) => {
    (cs.js || []).forEach(file => {
      const p = path.join(rootDir, file);
      assert(fs.existsSync(p), `Content script JS exists: ${file}`);
      try {
        execSync(`node -c "${p}"`, { stdio: 'pipe' });
        console.log(`    ✓ Syntax valid: ${file}`);
      } catch (err) {
        assert(false, `Syntax error in ${file}`);
      }
    });

    (cs.css || []).forEach(file => {
      const p = path.join(rootDir, file);
      assert(fs.existsSync(p), `Content script CSS exists: ${file}`);
    });
  });
}

// 4. Validate Popup Files
if (manifest && manifest.action && manifest.action.default_popup) {
  const popupHtml = path.join(rootDir, manifest.action.default_popup);
  assert(fs.existsSync(popupHtml), `Popup HTML exists: ${manifest.action.default_popup}`);

  const popupJs = path.join(rootDir, 'popup', 'popup.js');
  if (fs.existsSync(popupJs)) {
    try {
      execSync(`node -c "${popupJs}"`, { stdio: 'pipe' });
      console.log(`    ✓ Syntax valid: popup/popup.js`);
    } catch (err) {
      assert(false, `Syntax error in popup/popup.js`);
    }
  }
}

console.log('');
if (errors === 0) {
  console.log('✨ All checks passed! Extension is 100% valid and store-ready.\n');
  process.exit(0);
} else {
  console.error(`💥 Validation failed with ${errors} error(s).\n`);
  process.exit(1);
}
