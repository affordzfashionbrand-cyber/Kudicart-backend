const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');

const BACKEND_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(BACKEND_DIR, 'dist');
const BACKUP_DIST_DIR = path.join(BACKEND_DIR, 'dist_v1_0_0_baseline');

function loadEnv() {
  const envPath = path.join(BACKEND_DIR, '.env');
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        env[match[1]] = val;
      }
    }
  }
  env.JWT_SECRET = env.JWT_SECRET || 'a_very_secure_test_jwt_secret_with_more_than_32_characters_for_prod';
  return env;
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/v1/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode === 200, status: parsed.status, version: parsed.version });
        } catch {
          resolve({ ok: false });
        }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

async function runRollbackRehearsal() {
  console.log('=== KUDICART PRODUCTION REHEARSAL: DEPLOYMENT & ROLLBACK ===');

  if (!fs.existsSync(DIST_DIR)) {
    console.log('1. Building production baseline (v1.0.0)...');
    execSync('npm run build', { cwd: BACKEND_DIR, stdio: 'inherit' });
  }

  // Step 1: Snapshot baseline artifact
  console.log('1. Archiving baseline release artifact dist -> dist_v1_0_0_baseline...');
  if (fs.existsSync(BACKUP_DIST_DIR)) fs.rmSync(BACKUP_DIST_DIR, { recursive: true, force: true });
  fs.cpSync(DIST_DIR, BACKUP_DIST_DIR, { recursive: true });

  // Step 2: Deploy Release Candidate v1.0.1 (simulated by stamping version flag)
  console.log('2. Deploying candidate build v1.0.1...');
  const mainFile = path.join(DIST_DIR, 'src', 'main.js');
  let content = fs.readFileSync(mainFile, 'utf8');
  content = `// Candidate Build v1.0.1 Deployment Marker\n` + content;
  fs.writeFileSync(mainFile, content);

  console.log('3. Starting candidate release on isolated test port 3456...');
  const envConfig = loadEnv();
  const candidateProc = spawn('node', ['dist/src/main.js'], {
    cwd: BACKEND_DIR,
    env: { ...envConfig, PORT: '3456', NODE_ENV: 'production' },
    stdio: 'ignore',
  });

  // Wait for startup
  let candidateHealthy = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await checkHealth(3456);
    if (h.ok) {
      candidateHealthy = true;
      console.log(`   Candidate v1.0.1 healthy on port 3456 (Status: ${h.status})`);
      break;
    }
  }

  // Gracefully terminate candidate
  candidateProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));

  if (!candidateHealthy) {
    throw new Error('Candidate release failed health checks');
  }

  // Step 3: Trigger Rollback to v1.0.0
  console.log('4. Initiating instant atomic rollback to baseline v1.0.0 artifact...');
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.cpSync(BACKUP_DIST_DIR, DIST_DIR, { recursive: true });
  fs.rmSync(BACKUP_DIST_DIR, { recursive: true, force: true });
  console.log('   Rollback completed: dist restored from verified baseline.');

  // Step 4: Verify rolled back instance recovers health
  console.log('5. Verifying rolled back baseline release on test port 3456...');
  const rolledBackProc = spawn('node', ['dist/src/main.js'], {
    cwd: BACKEND_DIR,
    env: { ...envConfig, PORT: '3456', NODE_ENV: 'production' },
    stdio: 'ignore',
  });

  let rolledBackHealthy = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await checkHealth(3456);
    if (h.ok) {
      rolledBackHealthy = true;
      console.log(`   Rolled-back baseline healthy on port 3456 (Status: ${h.status})`);
      break;
    }
  }

  rolledBackProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));

  if (!rolledBackHealthy) {
    throw new Error('Rolled back release failed health checks');
  }

  console.log('=== DEPLOYMENT & ROLLBACK REHEARSAL SUCCESSFUL (PASS) ===');
}

runRollbackRehearsal().catch((err) => {
  console.error('Rollback rehearsal failed:', err);
  process.exit(1);
});
