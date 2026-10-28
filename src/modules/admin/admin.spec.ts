jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(async () => ({
      uid: 'fb-admin-123',
      phone_number: '+91 99999 00000',
      email: 'admin@kudicart.in',
      name: 'Operations Admin',
      role: 'ADMIN',
    })),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppModule } from '../../app.module';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminVendorsService } from './services/admin-vendors.service';
import { AdminCatalogService } from './services/admin-catalog.service';
import { AdminOrdersService } from './services/admin-orders.service';
import { AdminDriversService } from './services/admin-drivers.service';
import { AdminFinanceService } from './services/admin-finance.service';
import { AdminReviewsService } from './services/admin-reviews.service';
import { AdminSupportService } from './services/admin-support.service';
import { AdminAccessService } from './services/admin-access.service';
import { AdminReportsService } from './services/admin-reports.service';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminNotificationsService } from './services/admin-notifications.service';
import { AdminSettingsService } from './services/admin-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { Role } from '../../common/enums/role.enum';
import { createJwtToken } from '../../common/utils/crypto.util';

describe('KudiCart Admin Backend — Complete Domain, RBAC & Security Test Suite', () => {
  let authService: AdminAuthService;
  let dashboardService: AdminDashboardService;
  let usersService: AdminUsersService;
  let vendorsService: AdminVendorsService;
  let catalogService: AdminCatalogService;
  let ordersService: AdminOrdersService;
  let driversService: AdminDriversService;
  let financeService: AdminFinanceService;
  let reviewsService: AdminReviewsService;
  let supportService: AdminSupportService;
  let accessService: AdminAccessService;
  let reportsService: AdminReportsService;
  let auditService: AdminAuditService;
  let notificationsService: AdminNotificationsService;
  let settingsService: AdminSettingsService;
  let prismaService: PrismaService;
  let authGuard: FirebaseAuthGuard;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleRef.get<AdminAuthService>(AdminAuthService);
    dashboardService = moduleRef.get<AdminDashboardService>(AdminDashboardService);
    usersService = moduleRef.get<AdminUsersService>(AdminUsersService);
    vendorsService = moduleRef.get<AdminVendorsService>(AdminVendorsService);
    catalogService = moduleRef.get<AdminCatalogService>(AdminCatalogService);
    ordersService = moduleRef.get<AdminOrdersService>(AdminOrdersService);
    driversService = moduleRef.get<AdminDriversService>(AdminDriversService);
    financeService = moduleRef.get<AdminFinanceService>(AdminFinanceService);
    reviewsService = moduleRef.get<AdminReviewsService>(AdminReviewsService);
    supportService = moduleRef.get<AdminSupportService>(AdminSupportService);
    accessService = moduleRef.get<AdminAccessService>(AdminAccessService);
    reportsService = moduleRef.get<AdminReportsService>(AdminReportsService);
    auditService = moduleRef.get<AdminAuditService>(AdminAuditService);
    notificationsService = moduleRef.get<AdminNotificationsService>(AdminNotificationsService);
    settingsService = moduleRef.get<AdminSettingsService>(AdminSettingsService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);

    reflector = moduleRef.get<Reflector>(Reflector);
    authGuard = new FirebaseAuthGuard();
    rolesGuard = new RolesGuard(reflector);
  });

  // ================= 1. AUTHENTICATION & SESSION HANDLING =================
  describe('1. Admin Authentication & Session Handling', () => {
    it('Admin Login: authenticates with valid credentials, returns signed token and profile', async () => {
      const res = await authService.login({
        email: 'amara@kudicart.com',
        password: 'KudiCart#Admin2026!',
      });

      expect(res.success).toBe(true);
      expect(res.role).toBe(Role.ADMIN);
      expect(res.user.name).toBe('Amara Okonkwo');
      expect(res.token).toBeDefined();
      expect(res.token.split('.').length).toBe(3);
    });

    it('Admin Login: rejects incorrect password with 401 Unauthorized', async () => {
      await expect(
        authService.login({
          email: 'amara@kudicart.com',
          password: 'WrongPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Admin Login: rejects non-existent admin email with 401 Unauthorized', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@kudicart.com',
          password: 'KudiCart#Admin2026!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Admin Login: rejects deactivated/inactive admin accounts with 403 Forbidden', async () => {
      const store = prismaService.getStore();
      const inactiveUser = store.adminUsers.find((u: any) => u.email === 'tunde@kudicart.com');
      if (inactiveUser) inactiveUser.status = 'INACTIVE';

      await expect(
        authService.login({
          email: 'tunde@kudicart.com',
          password: 'KudiCart#Admin2026!',
        }),
      ).rejects.toThrow(ForbiddenException);

      if (inactiveUser) inactiveUser.status = 'ACTIVE';
    });

    it('Admin Profile: retrieves current authenticated profile and updates profile fields', async () => {
      const profile = await authService.getProfile('ADM-001');
      expect(profile.name).toBe('Amara Okonkwo');
      expect(profile.role).toBe(Role.ADMIN);

      const updated = await authService.updateProfile('ADM-001', {
        displayName: 'Amara Okonkwo-Smith',
      });
      expect(updated.user.name).toBe('Amara Okonkwo-Smith');
    });

    it('Admin Logout: terminates administrative session safely', async () => {
      const logoutRes = await authService.logout('ADM-001');
      expect(logoutRes.success).toBe(true);
    });
  });

  // ================= 2. RBAC & SECURITY BOUNDARIES =================
  describe('2. Role-Based Access Control (RBAC) & Security Boundaries', () => {
    it('RBAC: allows Admin token access to ADMIN-restricted routes', () => {
      const adminToken = createJwtToken({
        uid: 'ADM-001',
        role: Role.ADMIN,
      });

      const mockRequest: any = {
        headers: { authorization: `Bearer ${adminToken}` },
        url: '/api/v1/admin/dashboard/summary',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => {},
        getClass: () => {},
      };

      // 1. AuthGuard populates request.user
      const canAuth = authGuard.canActivate(mockContext);
      expect(canAuth).toBe(true);
      expect(mockRequest.user.role).toBe(Role.ADMIN);

      // 2. RolesGuard verifies Role.ADMIN
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      const canRole = rolesGuard.canActivate(mockContext);
      expect(canRole).toBe(true);
    });

    it('RBAC: blocks Customer token from accessing ADMIN-restricted routes with 403 Forbidden', () => {
      const customerToken = createJwtToken({
        uid: 'usr-1',
        role: Role.CUSTOMER,
      });

      const mockRequest: any = {
        headers: { authorization: `Bearer ${customerToken}` },
        url: '/api/v1/admin/orders',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => {},
        getClass: () => {},
      };

      // 1. AuthGuard populates customer role
      authGuard.canActivate(mockContext);
      expect(mockRequest.user.role).toBe(Role.CUSTOMER);

      // 2. RolesGuard enforces Role.ADMIN and must throw ForbiddenException
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('RBAC: blocks Driver token from accessing ADMIN-restricted routes with 403 Forbidden', () => {
      const driverToken = createJwtToken({
        uid: 'drv-1',
        role: Role.DRIVER,
      });

      const mockRequest: any = {
        headers: { authorization: `Bearer ${driverToken}` },
        url: '/api/v1/admin/delivery-partners',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => {},
        getClass: () => {},
      };

      authGuard.canActivate(mockContext);
      expect(mockRequest.user.role).toBe(Role.DRIVER);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('RBAC: rejects expired JWT tokens with 401 Unauthorized', () => {
      const expiredToken = createJwtToken(
        { uid: 'ADM-001', role: Role.ADMIN },
        process.env.JWT_SECRET,
        -10, // Expired 10 seconds ago
      );

      const mockRequest: any = {
        headers: { authorization: `Bearer ${expiredToken}` },
        url: '/api/v1/admin/orders',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('RBAC: rejects missing Authorization header on protected admin routes', () => {
      const mockRequest: any = {
        headers: {},
        url: '/api/v1/admin/orders',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });
  });

  // ================= 3. DASHBOARD & OPERATIONAL SUMMARIES =================
  describe('3. Dashboard & Operational Summaries', () => {
    it('Dashboard Summary: computes real operational aggregates and queue sizes from the database', async () => {
      const summary = await dashboardService.getSummary();

      expect(summary.actionRequired).toBeDefined();
      expect(typeof summary.actionRequired.unassignedCount).toBe('number');
      expect(typeof summary.actionRequired.pendingBoutiquesCount).toBe('number');
      expect(typeof summary.actionRequired.driverKycCount).toBe('number');

      expect(summary.metrics.totalOrders).toBeGreaterThanOrEqual(1);
      expect(summary.metrics.gov).toBeGreaterThan(0);
      expect(summary.metrics.activeVendors).toBeGreaterThanOrEqual(1);
      expect(summary.metrics.deliveryFleetCount).toBeGreaterThanOrEqual(1);

      expect(summary.pipelineCounts).toBeDefined();
      expect(summary.recentOrders.length).toBeGreaterThan(0);
      expect(summary.financialHealth.grossVolume).toBe(summary.metrics.gov);
    });
  });

  // ================= 4. CUSTOMERS / USERS MODULE =================
  describe('4. Customers / Users Management', () => {
    it('Customers: lists and filters customer directory with pagination', async () => {
      const list = await usersService.listCustomers({ page: 1, limit: 5 });
      expect(list.data.length).toBeGreaterThanOrEqual(1);
      expect(list.total).toBeGreaterThanOrEqual(1);

      const searched = await usersService.listCustomers({ search: 'Ananya' });
      expect(searched.data.length).toBeGreaterThan(0);
      expect(searched.data[0].name).toContain('Ananya');
    });

    it('Customers: retrieves single customer detail with addresses, orders, and tickets', async () => {
      const customer = await usersService.getCustomerById('usr-1');
      expect(customer.name).toBe('Ananya Sharma');
      expect(customer.addresses.length).toBeGreaterThan(0);
      expect(customer.orders.length).toBeGreaterThanOrEqual(1);
      expect(customer.customerNumber).toBeDefined();
    });

    it('Customers: toggles status to SUSPENDED and records audit trail event', async () => {
      const updateRes = await usersService.updateCustomerStatus(
        'usr-1',
        { status: 'SUSPENDED', reason: 'Payment dispute audit' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(updateRes.success).toBe(true);
      expect(updateRes.customer.status).toBe('SUSPENDED');

      // Verify audit log
      const audit = await auditService.listAuditEvents({ entityType: 'Customer' });
      expect(audit.data.some((e: any) => e.entityId === 'usr-1')).toBe(true);

      // Revert status
      await usersService.updateCustomerStatus('usr-1', { status: 'ACTIVE' });
    });
  });

  // ================= 5. VENDORS MODULE =================
  describe('5. Vendors / Boutiques Management', () => {
    it('Vendors: lists and filters vendors by status tab and category', async () => {
      const allVendors = await vendorsService.listVendors({});
      expect(allVendors.data.length).toBeGreaterThanOrEqual(2);

      const pendingVendors = await vendorsService.listVendors({ status: 'PENDING' });
      expect(pendingVendors.data.every((v: any) => v.status.includes('PENDING') || v.status.includes('SUBMITTED'))).toBe(true);
    });

    it('Vendors: retrieves single vendor dossier with documents and draft products', async () => {
      const vendor = await vendorsService.getVendorById('ven_7821');
      expect(vendor.storeName).toBe('Kashmir Loom Heritage');
      expect(vendor.documents.length).toBeGreaterThan(0);
      expect(vendor.bankDetails).toBeDefined();
    });

    it('Vendors: approves vendor, verifies documents, and records audit event', async () => {
      const approveRes = await vendorsService.approveVendor(
        'ven_7821',
        { reviewer: 'Amara Okonkwo' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(approveRes.success).toBe(true);
      expect(approveRes.vendor.status).toBe('ACTIVE');

      const audit = await auditService.listAuditEvents({ actionType: 'VENDOR_APPROVED' });
      expect(audit.data.some((e: any) => e.entityId === 'ven_7821')).toBe(true);
    });

    it('Vendors: rejects vendor application with reason and records audit event', async () => {
      const rejectRes = await vendorsService.rejectVendor(
        'ven_7821',
        { reason: 'GSTIN tax registration verification failed' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(rejectRes.success).toBe(true);
      expect(rejectRes.vendor.status).toBe('REJECTED');

      const audit = await auditService.listAuditEvents({ actionType: 'VENDOR_REJECTED' });
      expect(audit.data.some((e: any) => e.entityId === 'ven_7821')).toBe(true);
    });

    it('Vendors: toggles boutique suspension status', async () => {
      const suspendRes = await vendorsService.toggleSuspendVendor(
        'ven_7814',
        'ADM-001',
        'Amara Okonkwo',
      );
      expect(suspendRes.success).toBe(true);
      expect(suspendRes.vendor.status).toBe('SUSPENDED');

      // Toggle back
      await vendorsService.toggleSuspendVendor('ven_7814');
    });
  });

  // ================= 6. CATEGORIES & PRODUCTS =================
  describe('6. Categories & Products Management', () => {
    it('Categories: creates a new category with code and slug, then lists and updates it', async () => {
      const createRes = await catalogService.createCategory(
        {
          name: 'Designer Stoles',
          code: 'CAT-STOLE',
          slug: 'designer-stoles',
          description: 'Curated pashmina and silk stoles',
          status: 'ACTIVE',
        },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(createRes.success).toBe(true);
      expect(createRes.category.code).toBe('CAT-STOLE');

      // Update
      const updateRes = await catalogService.updateCategory(createRes.category.id, {
        description: 'Updated pashmina stoles description',
      });
      expect(updateRes.category.description).toContain('Updated');

      // Delete
      const deleteRes = await catalogService.deleteCategory(createRes.category.id);
      expect(deleteRes.success).toBe(true);
    });

    it('Categories: prevents duplicate category code or slug', async () => {
      await expect(
        catalogService.createCategory({
          name: 'Duplicate Kurtis',
          code: 'CAT-KURTIS',
          slug: 'kurtis', // 'kurtis' slug already exists in categories
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Products: lists catalog products with status and inventory badges', async () => {
      const list = await catalogService.listProducts({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].stockStatus).toBeDefined();
      expect(list.data[0].sellingPrice).toBeGreaterThan(0);
    });

    it('Products: retrieves single product with specifications, gallery assets, and boutique link', async () => {
      const product = await catalogService.getProductById('prod-1');
      expect(product.title).toBeDefined();
      expect(product.specifications.length).toBeGreaterThan(0);
      expect(product.galleryImages.length).toBeGreaterThan(0);
    });

    it('Products: updates listing status and stock inventory quantity', async () => {
      const statusRes = await catalogService.updateProductStatus(
        'prod-1',
        { listingStatus: 'REVIEW' },
        'ADM-001',
        'Amara Okonkwo',
      );
      expect((statusRes.product as any).listingStatus).toBe('REVIEW');

      const stockRes = await catalogService.updateProductStock(
        'prod-1',
        { stockQuantity: 4 },
        'ADM-001',
        'Amara Okonkwo',
      );
      expect(stockRes.product.stockQuantity).toBe(4);
      expect((stockRes.product as any).stockStatus).toBe('LOW_STOCK');

      // Reset
      await catalogService.updateProductStatus('prod-1', { listingStatus: 'ACTIVE' });
      await catalogService.updateProductStock('prod-1', { stockQuantity: 10 });
    });
  });

  // ================= 7. ORDERS & DELIVERY ASSIGNMENTS =================
  describe('7. Orders & Delivery Partner Assignments', () => {
    it('Orders: lists orders with search, status filtering, and date range', async () => {
      const list = await ordersService.listOrders({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].customerAddress).toBeDefined();
      expect(list.data[0].pickupHub).toBeDefined();
    });

    it('Orders: retrieves full order details, items, timeline history, and try & buy state', async () => {
      const order = await ordersService.getOrderById('ord-89241');
      expect(order.orderNumber).toBe('KC-89241');
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.history.length).toBeGreaterThan(0);
      expect(order.isTryAndBuy).toBe(true);
    });

    it('Manual Assignment: assigns delivery partner to order ready for pickup and records audit log', async () => {
      const store = prismaService.getStore();
      const testOrder = store.orders[0];
      testOrder.status = 'READY_FOR_PICKUP';

      const assignRes = await ordersService.assignDriver(
        testOrder.id,
        { driverId: 'drv-104', note: 'Priority boutique courier dispatch' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(assignRes.success).toBe(true);
      expect(assignRes.order.status).toBe('ASSIGNED');
      expect(assignRes.order.assignedDriver?.fullName).toBe('Deepak Solanki');

      // Verify audit log
      const audit = await auditService.listAuditEvents({ actionType: 'DRIVER_ASSIGNED_MANUAL' });
      expect(audit.data.some((e: any) => e.entityId === testOrder.orderNumber)).toBe(true);

      // Verify assignment queue reflects updated status
      const queue = await ordersService.listAssignments({});
      expect(queue.assignedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ================= 8. DELIVERY PARTNERS & KYC =================
  describe('8. Delivery Partners & KYC Dossiers', () => {
    it('Delivery Partners: lists partners with vehicle type and KYC status filters', async () => {
      const list = await driversService.listDrivers({});
      expect(list.data.length).toBeGreaterThanOrEqual(2);

      const evDrivers = await driversService.listDrivers({ vehicleType: 'EV' });
      expect(evDrivers.data.every((d: any) => d.vehicleType.includes('EV') || d.vehicleModel.includes('Ather'))).toBe(true);
    });

    it('Delivery Partners: retrieves full dossier with vehicle details and KYC documents', async () => {
      const partner = await driversService.getDriverById('drv-118');
      expect(partner.fullName).toBe('Suraj Verma');
      expect(partner.documents.selfie).toBeDefined();
      expect(partner.documents.aadhaar).toBeDefined();
      expect(partner.vehicleDetails.make).toBe('Ather');
    });

    it('Delivery Partners: approves KYC, updates document verification states, and appends audit trail', async () => {
      const approveRes = await driversService.reviewKyc(
        'drv-118',
        { status: 'APPROVED' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(approveRes.success).toBe(true);
      expect(approveRes.kycStatus).toBe('APPROVED');

      const updated = await driversService.getDriverById('drv-118');
      expect(updated.documents.aadhaar.status).toBe('VERIFIED');
      expect(updated.auditTrail.length).toBeGreaterThan(0);
    });

    it('Delivery Partners: rejects KYC, requires rejection reason, and records audit trail', async () => {
      // Missing rejection reason throws BadRequestException
      await expect(
        driversService.reviewKyc('drv-118', { status: 'REJECTED' }),
      ).rejects.toThrow(BadRequestException);

      const rejectRes = await driversService.reviewKyc(
        'drv-118',
        { status: 'REJECTED', rejectionReason: 'Driving License image blurred and illegible' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(rejectRes.success).toBe(true);
      expect(rejectRes.kycStatus).toBe('REJECTED');
      expect(rejectRes.rejectionReason).toContain('Driving License');
    });
  });

  // ================= 9. FINANCE: PAYMENTS & LEDGER =================
  describe('9. Payments & Vendor Settlement Ledger', () => {
    it('Payments: lists payments and calculates summary metrics', async () => {
      const list = await financeService.listPayments({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].gatewayPaymentId).toBeDefined();

      const metrics = await financeService.getPaymentMetrics();
      expect(metrics.settledToday).toBeGreaterThan(0);
      expect(metrics.captureRate).toBeGreaterThan(0);
      expect(metrics.razorpayOnline).toBeGreaterThan(0);
    });

    it('Ledger: lists vendor ledger entries, computes take rate, and updates settlement status', async () => {
      const list = await financeService.listLedger({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].commissionRate).toBeDefined();

      const metrics = await financeService.getLedgerMetrics();
      expect(metrics.grossMarketplaceVolume).toBeGreaterThan(0);
      expect(metrics.platformCommissionEarned).toBeGreaterThan(0);
      expect(metrics.averageTakeRate).toBeGreaterThan(0);

      const updateRes = await financeService.updateSettlementStatus(
        '#VEN-7821',
        { status: 'HOLD' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(updateRes.success).toBe(true);
      expect(updateRes.entry.status).toBe('HOLD');
    });
  });

  // ================= 10. REVIEWS & SUPPORT =================
  describe('10. Reviews Moderation & Support Tickets', () => {
    it('Reviews: lists reviews, calculates rating distribution, and moderates review status', async () => {
      const list = await reviewsService.listReviews({});
      expect(list.data.length).toBeGreaterThan(0);

      const metrics = await reviewsService.getReviewMetrics();
      expect(metrics.averageRating).toBeGreaterThanOrEqual(4.0);
      expect(metrics.ratingDistribution.length).toBe(5);

      const modRes = await reviewsService.moderateReview(
        '#REV-5510',
        { status: 'FLAGGED', flagReason: 'Repetitive promotional language' },
        'ADM-001',
        'Amara Okonkwo',
      );
      expect(modRes.success).toBe(true);
      expect(modRes.review.status).toBe('FLAGGED');
    });

    it('Support: lists tickets, calculates queue counts, and updates ticket status to RESOLVED', async () => {
      const list = await supportService.listTickets({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.counts.all).toBeGreaterThan(0);

      const updateRes = await supportService.updateTicket(
        '#TICK-4032',
        { status: 'RESOLVED', resolutionRemarks: 'Forwarded delivery landmark note to rider.' },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(updateRes.success).toBe(true);
      expect(updateRes.ticket.status).toBe('RESOLVED');
      expect(updateRes.ticket.resolvedAt).toBeDefined();
    });
  });

  // ================= 11. USER & ACCESS (IAM) =================
  describe('11. User & Access Management (IAM)', () => {
    it('IAM: lists administrative staff accounts excluding sensitive credentials', async () => {
      const users = await accessService.listUsers({});
      expect(users.data.length).toBeGreaterThanOrEqual(5);
      expect((users.data[0] as any).passwordHash).toBeUndefined();
    });

    it('IAM: invites new administrative user and updates role assignment', async () => {
      const inviteRes = await accessService.inviteUser(
        {
          name: 'Folake Adeyemi',
          email: 'folake@kudicart.com',
          role: 'Marketplace Operations',
          department: 'Fulfillment & Dispatch',
        },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(inviteRes.success).toBe(true);
      expect(inviteRes.user.email).toBe('folake@kudicart.com');
      expect((inviteRes.user as any).passwordHash).toBeUndefined();

      // Update role
      const updateRes = await accessService.updateUserRole(
        inviteRes.user.id,
        { role: 'Support Manager' },
        'ADM-001',
        'Amara Okonkwo',
      );
      expect(updateRes.user.role).toBe('Support Manager');
    });

    it('IAM: lists roles and updates role permissions matrix', async () => {
      const roles = await accessService.listRoles();
      expect(roles.data.length).toBeGreaterThanOrEqual(4);

      const permsRes = await accessService.updateRolePermissions(
        {
          roleId: 'role-marketplace-ops',
          permissions: {
            dashboard: ['view'],
            orders: ['view', 'edit'],
          },
        },
        'ADM-001',
        'Amara Okonkwo',
      );

      expect(permsRes.success).toBe(true);
      expect(permsRes.permissions.orders).toContain('edit');
    });
  });

  // ================= 12. REPORTS, AUDIT, NOTIFICATIONS, SETTINGS =================
  describe('12. Reports, Audit Logs, Notifications & Settings', () => {
    it('Reports: generates dynamic reporting dataset for ORDERS and CATALOG', async () => {
      const ordersReport = await reportsService.generateReport('ORDERS', {});
      expect(ordersReport.category).toBe('ORDERS');
      expect(ordersReport.data.length).toBeGreaterThan(0);

      const catalogReport = await reportsService.generateReport('CATALOG', {});
      expect(catalogReport.category).toBe('CATALOG');
      expect(catalogReport.data.length).toBeGreaterThan(0);
    });

    it('Audit Logs: lists immutable audit events with actor, entity, and change payloads', async () => {
      const audit = await auditService.listAuditEvents({});
      expect(audit.data.length).toBeGreaterThan(0);
      expect(audit.data[0].actionType).toBeDefined();
      expect(audit.data[0].actorRole).toBeDefined();
    });

    it('Notifications: lists notifications, marks as read, and broadcasts operational notice', async () => {
      const list = await notificationsService.listNotifications({});
      expect(list.data.length).toBeGreaterThan(0);

      const markRes = await notificationsService.markAsRead(list.data[0].id);
      expect(markRes.success).toBe(true);
      expect(markRes.notification.read).toBe(true);

      const broadcastRes = await notificationsService.broadcast(
        {
          title: 'Emergency Server Maintenance Scheduled',
          scope: 'Central Ops HQ',
          severity: 'Operational Warning',
          note: 'Maintenance window between 02:00 and 03:00 IST.',
        },
        'ADM-001',
        'Amara Okonkwo',
      );
      expect(broadcastRes.success).toBe(true);
      expect(broadcastRes.notification.title).toContain('Maintenance');
    });

    it('Settings: retrieves profile session info, updates workspace preferences', async () => {
      const profileInfo = await settingsService.getProfileAndSession('ADM-001');
      expect(profileInfo.profile.displayName).toBeDefined();
      expect(profileInfo.activeSession.gatewayIp).toBeDefined();

      const prefRes = await settingsService.savePreferences({
        defaultPageSize: 20,
        highDensityRows: true,
      });
      expect(prefRes.success).toBe(true);
      expect(prefRes.preferences.defaultPageSize).toBe(20);
    });
  });
});

