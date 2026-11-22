require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log("Starting database cleanup...");

  // 1. List of tables to truncate completely with CASCADE
  const tablesToTruncate = [
    // Catalog & Content
    "OrderItem",
    "Order",
    "OrderStatusHistory",
    "CheckoutGroup",
    "CartItem",
    "Cart",
    "Review",
    "SupportTicket",
    "PaymentTransaction",
    "DispatchAssignment",
    "TryAndBuySession",
    "Product",
    "HomeBanner",
    "HomeSectionItem",
    "HomeSectionConfig",
    "BankOffer",
    "Category",
    "DarkStoreHub",
    "Coupon",

    // Drivers & Logistics
    "DriverDocument",
    "DriverNotification",
    "DriverShift",
    "DriverSlotBooking",
    "DriverSlot",
    "DriverSurge",
    "DriverProfile",

    // Vendors & Finance
    "LedgerEntry",
    "VendorPayout",
    "Vendor",

    // Addresses
    "Address",

    // System logs, events & notifications
    "AuditLog",
    "DeviceToken",
    "IdempotencyKey",
    "Notification",
    "OutboxEvent",
    "WebhookEvent",
  ];

  console.log("Truncating content, catalog, orders, and logistics tables...");
  for (const table of tablesToTruncate) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      console.log(`  âœ“ Truncated table: ${table}`);
    } catch (err) {
      console.error(`  âœ— Error truncating ${table}:`, err.message);
    }
  }

  // 2. Clean User table: remove customers, drivers, vendors, keep only ADMIN
  console.log("Cleaning non-admin users from User table...");
  const deletedUsers = await prisma.$executeRawUnsafe(
    `DELETE FROM "User" WHERE "role" != 'ADMIN';`
  );
  console.log(`  âœ“ Deleted ${deletedUsers} non-admin users.`);

  // 3. Clean WorkspaceSetting: remove vendorDossiers, keep adminCredentials, rolePermissions, workspacePreferences
  console.log("Cleaning vendor dossiers from WorkspaceSetting...");
  await prisma.$executeRawUnsafe(
    `DELETE FROM "WorkspaceSetting" WHERE "key" = 'vendorDossiers';`
  );
  console.log(`  âœ“ Cleaned vendor dossiers from WorkspaceSetting.`);

  // 4. Verify admin user exists or ensure default admin user is present
  const adminUsers = await prisma.user.findMany({ where: { role: "ADMIN" } });
  console.log(`Current ADMIN users remaining: ${adminUsers.length}`);
  for (const adm of adminUsers) {
    console.log(`  - Admin: ${adm.name} (${adm.email}) [ID: ${adm.id}]`);
  }

  // 5. Final verification of all tables and remaining row counts
  console.log("\n================ TABLE SUMMARY POST-CLEANUP ================");
  const allTables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;

  let totalRemainingRows = 0;
  for (const t of allTables) {
    const res = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "${t.table_name}"`
    );
    const count = res[0].count;
    if (count > 0) {
      console.log(`  ${t.table_name}: ${count} rows`);
      totalRemainingRows += count;
    }
  }
  console.log(`Total remaining rows in DB: ${totalRemainingRows}`);
  console.log("============================================================\n");

  await prisma.$disconnect();
}

clearDatabase().catch((e) => {
  console.error("Cleanup failed:", e);
  process.exit(1);
});
