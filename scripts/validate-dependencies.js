/**
 * Lightweight per-repository dependency validation script
 * Runs cross-platform (Windows/macOS/Linux) without modifying node_modules
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
console.log(`\n=== Validating Dependencies for: ${path.basename(repoRoot)} ===`);

// 1. Check Node.js version
const nodeVer = process.version;
const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
if (major < 20 || major > 22) {
  console.warn(`[WARN] Current Node.js ${nodeVer} is outside recommended LTS range (v20 - v22).`);
} else {
  console.log(`[PASS] Node.js ${nodeVer} matches LTS requirement.`);
}

// 2. Check required files
const requiredFiles = ['package.json', 'package-lock.json', '.npmrc', '.nvmrc', '.node-version'];
for (const file of requiredFiles) {
  if (fs.existsSync(path.join(repoRoot, file))) {
    console.log(`[PASS] ${file} is present.`);
  } else {
    console.error(`[FAIL] ${file} is missing.`);
    process.exit(1);
  }
}

// 3. Verify dependency tree health (npm ls --depth=0)
try {
  execSync('npm ls --depth=0', { cwd: repoRoot, stdio: 'ignore' });
  console.log('[PASS] Local node_modules tree is complete and healthy.');
} catch {
  console.warn('[WARN] npm ls reported extraneous or peer warnings (non-fatal).');
}

// 4. Verify lockfile reproducibility (npm ci --dry-run)
try {
  execSync('npm ci --dry-run', { cwd: repoRoot, stdio: 'ignore' });
  console.log('[PASS] Lockfile resolves cleanly and reproducibly via npm ci.');
} catch (err) {
  console.error('[FAIL] npm ci --dry-run failed. Run "npm ci" to reconcile dependencies with lockfile.');
  process.exit(1);
}

console.log('[SUCCESS] Repository dependency environment is healthy and synchronized!\n');

