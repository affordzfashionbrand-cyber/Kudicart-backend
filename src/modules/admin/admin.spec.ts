import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AdminModule & Backoffice Operations (Phase 1)', () => {
  let adminService: AdminService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, PrismaService],
    }).compile();

    adminService = module.get<AdminService>(AdminService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(adminService).toBeDefined();
  });

  describe('Dashboard Aggregations', () => {
    it('should calculate live operational queues and order lifecycle pipeline counts', async () => {
      const summary = await adminService.getDashboardSummary('today');
      expect(summary).toBeDefined();
      expect(summary.operationalQueues).toBeDefined();
      expect(summary.operationalQueues.unassignedOrders).toBeGreaterThanOrEqual(0);
      expect(summary.lifecyclePipeline).toBeDefined();
      expect(summary.lifecyclePipeline).toHaveProperty('placed');
      expect(summary.lifecyclePipeline).toHaveProperty('readyForPickup');
      expect(summary.lifecyclePipeline).toHaveProperty('delivered');
      expect(summary.metrics.grossVolume).toBeGreaterThan(0);
    });
  });

  describe('Manual Driver Assignment (D-006 Invariant)', () => {
    it('should assign a specific driver to an order and record an immutable audit log', async () => {
      const store = prismaService.getStore();
      const testOrderId = store.orders[0]?.id || 'ord-1';
      const testDriverId = store.drivers[0]?.id || 'drv-1';

      const res = await adminService.assignDriverToOrder(testOrderId, testDriverId, {
        id: 'usr-admin-1',
        email: 'admin@kudicart.in',
      });

      expect(res.success).toBe(true);
      expect(res.order.driverId).toBe(testDriverId);
      expect(res.order.status).toBe('ASSIGNED');

      // Verify audit log recorded
      const audit = await adminService.listAuditLogs();
      const assignmentLog = audit.data.find(
        (log: any) => log.action === 'MANUAL_DRIVER_ASSIGNED' && log.entityId === testOrderId,
      );
      expect(assignmentLog).toBeDefined();
    });

    it('should list assignments with readyCount and assignedCount for the admin dispatch view', async () => {
      const assignments = await adminService.listAssignments();
      expect(assignments.data).toBeDefined();
      expect(typeof assignments.readyCount).toBe('number');
      expect(typeof assignments.assignedCount).toBe('number');
    });
  });

  describe('Driver Fleet & KYC Management', () => {
    it('should review driver KYC and update document approval status', async () => {
      const store = prismaService.getStore();
      const testDriverId = store.drivers[0]?.id || 'drv-1';

      const res = await adminService.updateDriverKyc(
        testDriverId,
        { status: 'APPROVED', notes: 'All Aadhaar and DL verified' },
        { id: 'usr-admin-1', email: 'admin@kudicart.in' },
      );

      expect(res.success).toBe(true);
      expect(res.driver.kycStatus).toBe('APPROVED');
    });

    it('should list delivery partners with complete telemetry fields', async () => {
      const partners = await adminService.listDeliveryPartners();
      expect(partners.data.length).toBeGreaterThan(0);
      const partner = partners.data[0];
      expect(partner).toHaveProperty('driverCode');
      expect(partner).toHaveProperty('fullName');
      expect(partner).toHaveProperty('vehicleModel');
      expect(partner).toHaveProperty('kycStatus');
    });
  });

  describe('RBAC & Audit Logging', () => {
    it('should provide comprehensive user permissions list for role enforcement', async () => {
      const perms = await adminService.getUserPermissions();
      expect(perms.data).toContain('orders.assign_driver');
      expect(perms.data).toContain('vendors.approve');
      expect(perms.data).toContain('ledger.view');
      expect(perms.data).toContain('drivers.kyc_review');
    });

    it('should provide system preferences showing autoDispatch is false', async () => {
      const prefs = await adminService.getPreferences();
      expect(prefs.autoDispatch).toBe(false); // Invariant D-006 check
    });
  });
});
