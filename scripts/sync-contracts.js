const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const sourceFile = path.resolve(__dirname, '..', 'src', 'common', 'contracts', 'order-contracts.ts');

const targets = [
  path.join(rootDir, 'kudicart-customer-app', 'src', 'contracts', 'order-contracts.ts'),
  path.join(rootDir, 'kudicart-driver-app', 'src', 'contracts', 'order-contracts.ts'),
  path.join(rootDir, 'kudicart-admin-vendor-web', 'src', 'contracts', 'order-contracts.ts'),
];

const source = fs.readFileSync(sourceFile, 'utf8');
const banner = '// AUTO-SYNCED FROM kudicart-backend/src/common/contracts/order-contracts.ts — DO NOT EDIT DIRECTLY\n\n';

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, banner + source, 'utf8');
  console.log(`Synced contract -> ${path.relative(rootDir, target)}`);
}
