const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const PG_BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PG_DUMP = path.join(PG_BIN, 'pg_dump.exe');
const PG_RESTORE = path.join(PG_BIN, 'pg_restore.exe');
const PSQL = path.join(PG_BIN, 'psql.exe');

const BACKUP_FILE = path.join(__dirname, 'staging_rehearsal_backup.dump');
const SOURCE_DB = 'kudicart';
const TARGET_DB = 'kudicart_restore_rehearsal';
const PORT = '5433';
const USER = 'postgres';

async function runRehearsal() {
  console.log('=== KUDICART PRODUCTION REHEARSAL: BACKUP & RESTORE ===');
  
  // 1. Initial State Check on Source Database
  const sourcePrisma = new PrismaClient({
    datasources: { db: { url: `postgresql://${USER}@127.0.0.1:${PORT}/${SOURCE_DB}` } },
  });
  
  const sourceCounts = {
    users: await sourcePrisma.user.count(),
    products: await sourcePrisma.product.count(),
    orders: await sourcePrisma.order.count(),
    orderItems: await sourcePrisma.orderItem.count(),
    auditLogs: await sourcePrisma.auditLog.count(),
    driverProfiles: await sourcePrisma.driverProfile.count(),
  };
  console.log('1. Source DB counts:', sourceCounts);
  await sourcePrisma.$disconnect();

  // 2. Perform Custom-Format Compressed pg_dump
  console.log(`2. Dumping ${SOURCE_DB} to ${BACKUP_FILE}...`);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  execSync(`"${PG_DUMP}" -h 127.0.0.1 -p ${PORT} -U ${USER} -F c -f "${BACKUP_FILE}" ${SOURCE_DB}`, {
    stdio: 'inherit',
  });
  const backupStats = fs.statSync(BACKUP_FILE);
  console.log(`   Backup complete. Size: ${backupStats.size} bytes.`);

  // 3. Create Clean Target Isolation Database
  console.log(`3. Preparing empty isolated database '${TARGET_DB}'...`);
  try {
    execSync(`"${PSQL}" -h 127.0.0.1 -p ${PORT} -U ${USER} -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"`, { stdio: 'ignore' });
    execSync(`"${PSQL}" -h 127.0.0.1 -p ${PORT} -U ${USER} -d postgres -c "CREATE DATABASE ${TARGET_DB};"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to create target DB:', err.message);
    throw err;
  }

  // 4. Execute pg_restore into Isolated Target Database
  console.log(`4. Restoring backup into ${TARGET_DB}...`);
  try {
    execSync(`"${PG_RESTORE}" -h 127.0.0.1 -p ${PORT} -U ${USER} -d ${TARGET_DB} --no-owner --no-privileges "${BACKUP_FILE}"`, {
      stdio: 'pipe',
    });
  } catch (err) {
    // pg_restore returns non-zero for warnings, verify if tables restored
    console.log('   pg_restore completed with notifications.');
  }

  // 5. Connect Prisma to Target DB and Verify Integrity
  console.log(`5. Verifying restored data in '${TARGET_DB}'...`);
  const targetPrisma = new PrismaClient({
    datasources: { db: { url: `postgresql://${USER}@127.0.0.1:${PORT}/${TARGET_DB}` } },
  });

  const targetCounts = {
    users: await targetPrisma.user.count(),
    products: await targetPrisma.product.count(),
    orders: await targetPrisma.order.count(),
    orderItems: await targetPrisma.orderItem.count(),
    auditLogs: await targetPrisma.auditLog.count(),
    driverProfiles: await targetPrisma.driverProfile.count(),
  };
  console.log('   Restored DB counts:', targetCounts);

  // Assert Exact Match
  for (const [key, val] of Object.entries(sourceCounts)) {
    if (targetCounts[key] !== val) {
      throw new Error(`Integrity mismatch on ${key}: expected ${val}, got ${targetCounts[key]}`);
    }
  }
  console.log('   --> DATA INTEGRITY ASSERTION PASSED: 100% record parity.');

  // 6. Test App Query Capabilities on Restored DB
  const sampleOrder = await targetPrisma.order.findFirst({
    include: { items: true, history: true },
  });
  if (sampleOrder) {
    console.log(`6. Sample restored order #${sampleOrder.orderNumber}: status=${sampleOrder.status}, grandTotal=${sampleOrder.grandTotal}, itemsCount=${sampleOrder.items.length}`);
  } else {
    console.log('6. Order table queried successfully (0 sample records found).');
  }

  await targetPrisma.$disconnect();

  // 7. Cleanup Test Database & File
  console.log(`7. Cleaning up test database '${TARGET_DB}' and dump file...`);
  execSync(`"${PSQL}" -h 127.0.0.1 -p ${PORT} -U ${USER} -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"`, { stdio: 'ignore' });
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);

  console.log('=== BACKUP & RESTORE REHEARSAL SUCCESSFUL (PASS) ===');
}

runRehearsal().catch((err) => {
  console.error('Rehearsal failed:', err);
  process.exit(1);
});
