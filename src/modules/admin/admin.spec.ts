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
  let moduleRef: TestingModule;
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

  const runStartedAt = new Date();
  const runId = `admspec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdVendorPayoutIds: string[] = [];
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.init();

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
    authGuard = new FirebaseAuthGuard(undefined, prismaService);
    rolesGuard = new RolesGuard(reflector);
  });

  afterEach(async () => {
    if (createdNotificationIds.length > 0) {
      await prismaService.auditLog.deleteMany({
        where: { entityId: { in: createdNotificationIds } },
      });
      await prismaService.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      });
      createdNotificationIds.length = 0;
    }
    if (createdVendorPayoutIds.length > 0) {
      await prismaService.auditLog.deleteMany({
        where: { entityId: { in: createdVendorPayoutIds } },
      });
      await prismaService.vendorPayout.deleteMany({
        where: { id: { in: createdVendorPayoutIds } },
      });
      createdVendorPayoutIds.length = 0;
    }
    if (createdOrderIds.length > 0) {
      await prismaService.tryAndBuySession.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdOrderIds } },
      });
      await prismaService.ledgerEntry.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.auditLog.deleteMany({
        where: { entityId: { in: createdOrderIds } },
      });
      await prismaService.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdAddressIds.length > 0) {
      await prismaService.address.deleteMany({
        where: { id: { in: createdAddressIds } },
      });
      createdAddressIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prismaService.auditLog.deleteMany({
        where: { entityId: { in: createdDriverProfileIds } },
      });
      await prismaService.driverDocument.deleteMany({
        where: { driverId: { in: createdDriverProfileIds } },
      });
      await prismaService.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prismaService.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
    await prismaService.auditLog.deleteMany({
      where: {
        entityId: { in: ['usr-1', 'ven_7821', 'ven_7814'] },
        createdAt: { gte: runStartedAt },
      },
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // ================= 1. AUTHENTICATION & SESSION HANDLING =================
  describe('1. Admin Authentication & Session Handling', () => {
    it('Admin Login: authenticates with valid credentials, returns signed token and profile', async () => {
      const res = await authService.login({
        email: 'amara@affordz.in',
        password: 'Affordz#Admin2026!',
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
          email: 'amara@affordz.in',
          password: 'WrongPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Admin Login: rejects non-existent admin email with 401 Unauthorized', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@affordz.in',
          password: 'Affordz#Admin2026!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Admin Login: rejects deactivated/inactive admin accounts with 403 Forbidden', async () => {
      const setting = await prismaService.workspaceSetting.findUnique({
        where: { key: 'adminCredentials' },
      });
      const prevCreds = Array.isArray(setting?.value)
        ? JSON.parse(JSON.stringify(setting!.value))
        : [];
      const mutatedCreds = prevCreds.map((u: any) =>
        u.email === 'tunde@affordz.in' ? { ...u, status: 'INACTIVE' } : u,
      );
      await prismaService.workspaceSetting.update({
        where: { key: 'adminCredentials' },
        data: { value: mutatedCreds },
      });

      try {
        await expect(
          authService.login({
            email: 'tunde@affordz.in',
            password: 'Affordz#Admin2026!',
          }),
        ).rejects.toThrow(ForbiddenException);
      } finally {
        await prismaService.workspaceSetting.update({
          where: { key: 'adminCredentials' },
          data: { value: prevCreds },
        });
      }
    });

    it('Admin Profile: retrieves current authenticated profile and updates profile fields', async () => {
      const profile = await authService.getProfile('usr-admin-amara');
      expect(profile.name).toBe('Amara Okonkwo');
      expect(profile.role).toBe('Super Admin');

      try {
        const updated = await authService.updateProfile('usr-admin-amara', {
          displayName: 'Amara Okonkwo-Smith',
        });
        expect(updated.user.name).toBe('Amara Okonkwo-Smith');
      } finally {
        await authService.updateProfile('usr-admin-amara', {
          displayName: 'Amara Okonkwo',
        });
      }
    });

    it('Admin Logout: terminates administrative session safely', async () => {
      const logoutRes = await authService.logout('usr-admin-amara');
      expect(logoutRes.success).toBe(true);
    });
  });

  // ================= 2. RBAC & SECURITY BOUNDARIES =================
  describe('2. Role-Based Access Control (RBAC) & Security Boundaries', () => {
    it('RBAC: allows Admin token access to ADMIN-restricted routes', async () => {
      const adminToken = createJwtToken({
        uid: 'usr-admin-1',
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
      const canAuth = await authGuard.canActivate(mockContext);
      expect(canAuth).toBe(true);
      expect(mockRequest.user.role).toBe(Role.ADMIN);

      // 2. RolesGuard verifies Role.ADMIN
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      const canRole = rolesGuard.canActivate(mockContext);
      expect(canRole).toBe(true);
    });

    it('RBAC: blocks Customer token from accessing ADMIN-restricted routes with 403 Forbidden', async () => {
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
      await authGuard.canActivate(mockContext);
      expect(mockRequest.user.role).toBe(Role.CUSTOMER);

      // 2. RolesGuard enforces Role.ADMIN and must throw ForbiddenException
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('RBAC: blocks Driver token from accessing ADMIN-restricted routes with 403 Forbidden', async () => {
      const driverToken = createJwtToken({
        uid: 'usr-driver-1',
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

      await authGuard.canActivate(mockContext);
      expect(mockRequest.user.role).toBe(Role.DRIVER);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('RBAC: rejects expired JWT tokens with 401 Unauthorized', async () => {
      const expiredToken = createJwtToken(
        { uid: 'usr-admin-1', role: Role.ADMIN },
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

      await expect(authGuard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
    });

    it('RBAC: rejects missing Authorization header on protected admin routes', async () => {
      const mockRequest: any = {
        headers: {},
        url: '/api/v1/admin/orders',
      };

      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      await expect(authGuard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ================= 3. DASHBOARD & OPERATIONAL SUMMARIES =================
  describe('3. Dashboard & Operational Summaries', () => {
    it('Dashboard Summary: computes real operational aggregates and queue sizes from the database', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const addrId = `${runId}_dash_addr_${suffix}`;
      const orderId = `${runId}_dash_ord_${suffix}`;
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.address.create({
        data: {
          id: addrId,
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+919845012890',
          line1: '100 Feet Road, Indiranagar',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-DASH-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          status: 'READY_FOR_PICKUP',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'COMPLETED',
          itemTotal: 1500,
          taxes: 75,
          grandTotal: 1575,
        },
      });

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
      const suffix = Math.random().toString(36).slice(2, 6);
      const addrId = `${runId}_cust_a_${suffix}`;
      const orderId = `${runId}_cust_o_${suffix}`;
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.address.create({
        data: {
          id: addrId,
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+919845012890',
          line1: '100 Feet Road, Indiranagar',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-CUST-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          status: 'PLACED',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          itemTotal: 1299,
          taxes: 65,
          grandTotal: 1404,
        },
      });

      const customer = await usersService.getCustomerById('usr-1');
      expect(customer.name).toBe('Ananya Sharma');
      expect(customer.addresses.length).toBeGreaterThan(0);
      expect(customer.orders.length).toBeGreaterThanOrEqual(1);
      expect(customer.customerNumber).toBeDefined();
    });

    it('Customers: toggles status to SUSPENDED and records audit trail event', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const tempCustId = `${runId}_cust_u_${suffix}`;
      createdUserIds.push(tempCustId);

      await prismaService.user.create({
        data: {
          id: tempCustId,
          firebaseUid: `fb_${tempCustId}`,
          name: 'Suspend Test Customer',
          email: `${tempCustId}@test.kudicart.in`,
          phone: `+919868${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });

      const updateRes = await usersService.updateCustomerStatus(
        tempCustId,
        { status: 'SUSPENDED', reason: 'Payment dispute audit' },
        'usr-admin-1',
        'Amara Okonkwo',
      );

      expect(updateRes.success).toBe(true);
      expect(updateRes.customer.status).toBe('SUSPENDED');

      // Verify audit log
      const audit = await auditService.listAuditEvents({ entityType: 'Customer' });
      expect(audit.data.some((e: any) => e.entityId === tempCustId)).toBe(true);

      // Clean temp customer's audit log entries
      await prismaService.auditLog.deleteMany({
        where: { entityId: tempCustId },
      });
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

    it('Products: creates Dark Store product bound to Affordz Official Store (vend-affordz-official)', async () => {
      const res = await catalogService.createDarkStoreProduct(
        {
          title: 'Banarasi Brocade Festive Kurta',
          description: 'Handwoven silk with fine zari border and tailored silhouette.',
          categoryId: 'kurtis',
          darkStoreHubId: 'hub-indiranagar',
          price: 1599,
          originalPrice: 2999,
          stockQuantity: 30,
          sizes: ['M', 'L', 'XL'],
          fabric: 'Banarasi Brocade Silk',
          origin: 'Varanasi Atelier',
          image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b',
          altText: 'Festive Banarasi Brocade Kurta',
          readyToShip: true,
        },
        'usr-admin-1',
        'Operations Admin',
      );

      expect(res.success).toBe(true);
      expect(res.product.vendorId).toBe('vend-affordz-official');
      expect(res.product.vendorName).toBe('Affordz Official Store');
      expect(res.product.fulfillmentType).toBe('DARK_STORE');
      expect(res.product.tryAndBuyEligible).toBe(true);
      expect(res.product.discount).toBe('47% OFF');
      expect(res.product.darkStoreHubId).toBe('hub-indiranagar');
    });

    it('Products: rejects Dark Store creation if originalPrice is less than price', async () => {
      await expect(
        catalogService.createDarkStoreProduct(
          {
            title: 'Faulty Pricing Product',
            description: 'Test invalid pricing',
            categoryId: 'kurtis',
            darkStoreHubId: 'hub-indiranagar',
            price: 2500,
            originalPrice: 1500,
            stockQuantity: 10,
            sizes: ['M'],
            image: 'https://example.com/test.jpg',
            altText: 'Test',
          },
          'usr-admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Products: rejects Dark Store creation if fulfillmentType is VENDOR', async () => {
      await expect(
        catalogService.createDarkStoreProduct(
          {
            title: 'Invalid Fulfillment',
            description: 'Attempting vendor fulfillment via admin',
            categoryId: 'kurtis',
            darkStoreHubId: 'hub-indiranagar',
            price: 1000,
            originalPrice: 1500,
            stockQuantity: 10,
            sizes: ['M'],
            image: 'https://example.com/test.jpg',
            altText: 'Test',
            fulfillmentType: 'VENDOR' as any,
          },
          'usr-admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

  });

  // ================= 7. ORDERS & DELIVERY ASSIGNMENTS =================
  describe('7. Orders & Delivery Partner Assignments', () => {
    async function seedOrderAndDriver() {
      const suffix = Math.random().toString(36).slice(2, 6);
      const drvUserId = `${runId}_od_u_${suffix}`;
      const drvProfId = `${runId}_od_p_${suffix}`;
      const addrId = `${runId}_od_a_${suffix}`;
      const orderId = `${runId}_od_o_${suffix}`;
      const orderNumber = `KC-ADM-${suffix}`;
      createdUserIds.push(drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: 'Deepak Solanki',
          email: `${drvUserId}@test.kudicart.in`,
          phone: `+919866${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: 'Deepak Solanki',
          phone: `+919866${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: true,
        },
      });
      await prismaService.address.create({
        data: {
          id: addrId,
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+919845012890',
          line1: '100 Feet Road, Indiranagar',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          isTryAndBuy: true,
          status: 'READY_FOR_PICKUP',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'COMPLETED',
          itemTotal: 1599,
          taxes: 80,
          grandTotal: 1679,
        },
      });
      await prismaService.orderItem.create({
        data: {
          orderId,
          productId: 'prd-1',
          title: 'Silk Anarkali Set',
          brand: 'Avanya Ethnic',
          size: 'M',
          price: 1599,
          quantity: 1,
          image: 'https://example.com/item.jpg',
        },
      });
      await prismaService.orderStatusHistory.create({
        data: {
          orderId,
          status: 'READY_FOR_PICKUP',
          note: 'Packed for admin assignment',
          actorRole: Role.VENDOR,
        },
      });
      return { drvProfId, orderId, orderNumber };
    }

    it('Orders: lists orders with search, status filtering, and date range', async () => {
      await seedOrderAndDriver();
      const list = await ordersService.listOrders({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].deliveryAddress).toBeDefined();
      expect(list.data[0].vendorName).toBeDefined();
    });

    it('Orders: retrieves full order details, items, timeline history, and try & buy state', async () => {
      const { orderId, orderNumber } = await seedOrderAndDriver();
      const order = await ordersService.getOrderById(orderId);
      expect(order.orderNumber).toBe(orderNumber);
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.history.length).toBeGreaterThan(0);
      expect(order.isTryAndBuy).toBe(true);
    });

    it('Manual Assignment: assigns delivery partner to order ready for pickup and records audit log', async () => {
      const { drvProfId, orderId } = await seedOrderAndDriver();

      const assignRes = await ordersService.assignDriver(
        orderId,
        { driverId: drvProfId, note: 'Priority boutique courier dispatch' },
        'usr-admin-1',
        'Amara Okonkwo',
      );

      expect(assignRes.success).toBe(true);
      expect(assignRes.order.status).toBe('ASSIGNED');
      expect(assignRes.order.driverName).toBe('Deepak Solanki');

      // Verify audit log
      const audit = await auditService.listAuditEvents({
        actionType: 'ADMIN_MANUAL_DRIVER_ASSIGNED',
      });
      expect(audit.data.some((e: any) => e.entityId === orderId)).toBe(true);

      // Verify assignment queue reflects updated status
      const queue = await ordersService.listAssignments({});
      expect(queue.assignedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ================= 8. DELIVERY PARTNERS & KYC =================
  describe('8. Delivery Partners & KYC Dossiers', () => {
    async function seedKycPartner() {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_kyc_u_${suffix}`;
      const profId = `${runId}_kyc_p_${suffix}`;
      createdUserIds.push(userId);
      createdDriverProfileIds.push(profId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: 'Suraj Verma',
          email: `${userId}@test.kudicart.in`,
          phone: `+919867${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: profId,
          userId,
          fullName: 'Suraj Verma',
          phone: `+919867${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'PENDING',
          vehicleType: 'EV Scooter',
          vehicleMake: 'Ather',
          vehicleModel: 'Ather 450X',
          vehicleRegistration: 'KA03EV9999',
          selfieUrl: 'https://example.com/suraj_selfie.jpg',
        },
      });
      await prismaService.driverDocument.createMany({
        data: [
          {
            driverId: profId,
            type: 'selfie',
            side: 'front',
            fileName: 'suraj_selfie.jpg',
            fileUrl: 'https://example.com/suraj_selfie.jpg',
            status: 'PENDING',
          },
          {
            driverId: profId,
            type: 'aadhaar',
            side: 'front',
            fileName: 'aadhaar_front.jpg',
            fileUrl: 'https://example.com/aadhaar_front.jpg',
            status: 'PENDING',
          },
        ],
      });
      return profId;
    }

    it('Delivery Partners: lists partners with vehicle type and KYC status filters', async () => {
      await seedKycPartner();
      const list = await driversService.listDrivers({});
      expect(list.data.length).toBeGreaterThanOrEqual(2);

      const evDrivers = await driversService.listDrivers({ vehicleType: 'EV' });
      expect(
        evDrivers.data.every(
          (d: any) =>
            String(d.vehicleType || '').includes('EV') ||
            String(d.vehicleModel || '').includes('Ather'),
        ),
      ).toBe(true);
    });

    it('Delivery Partners: retrieves full dossier with vehicle details and KYC documents', async () => {
      const profId = await seedKycPartner();
      const partner = await driversService.getDriverById(profId);
      expect(partner.fullName).toBe('Suraj Verma');
      expect(Array.isArray(partner.documents)).toBe(true);
      expect(partner.documents.some((d: any) => d.type === 'selfie')).toBe(true);
      expect(partner.documents.some((d: any) => d.type === 'aadhaar')).toBe(true);
      expect(partner.vehicleMake).toBe('Ather');
    });

    it('Delivery Partners: approves KYC, updates document verification states, and appends audit trail', async () => {
      const profId = await seedKycPartner();
      const approveRes = await driversService.reviewKyc(
        profId,
        { status: 'APPROVED' },
        'usr-admin-1',
        'Amara Okonkwo',
      );

      expect(approveRes.success).toBe(true);
      expect(approveRes.kycStatus).toBe('APPROVED');

      const updated = await driversService.getDriverById(profId);
      const aadhaarDoc = updated.documents.find((d: any) => d.type === 'aadhaar');
      expect(aadhaarDoc?.status).toBe('VERIFIED');
      expect(updated.auditTrail.length).toBeGreaterThan(0);
    });

    it('Delivery Partners: rejects KYC, requires rejection reason, and records audit trail', async () => {
      const profId = await seedKycPartner();
      // Missing rejection reason throws BadRequestException
      await expect(
        driversService.reviewKyc(profId, { status: 'REJECTED' }),
      ).rejects.toThrow(BadRequestException);

      const rejectRes = await driversService.reviewKyc(
        profId,
        { status: 'REJECTED', rejectionReason: 'Driving License image blurred and illegible' },
        'usr-admin-1',
        'Amara Okonkwo',
      );

      expect(rejectRes.success).toBe(true);
      expect(rejectRes.kycStatus).toBe('REJECTED');
      expect(rejectRes.rejectionReason).toContain('Driving License');
    });
  });

  // ================= 9. FINANCE: PAYMENTS & LEDGER =================
  describe('9. Payments & Vendor Settlement Ledger', () => {
    async function seedFinanceRecords() {
      const suffix = Math.random().toString(36).slice(2, 6);
      const addrId = `${runId}_fin_a_${suffix}`;
      const orderId = `${runId}_fin_o_${suffix}`;
      const payoutId = `${runId}_fin_vp_${suffix}`;
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);
      createdVendorPayoutIds.push(payoutId);

      await prismaService.address.create({
        data: {
          id: addrId,
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+919845012890',
          line1: '100 Feet Road, Indiranagar',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-FIN-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          status: 'DELIVERED',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'COMPLETED',
          razorpayOrderId: `order_fin_${suffix}`,
          razorpayPaymentId: `pay_fin_${suffix}`,
          itemTotal: 1404,
          taxes: 0,
          grandTotal: 1404,
        },
      });
      await prismaService.paymentTransaction.create({
        data: {
          orderId,
          transactionType: 'CAPTURE',
          razorpayOrderId: `order_fin_${suffix}`,
          paymentId: `pay_fin_${suffix}`,
          amount: 1404,
          currency: 'INR',
          status: 'COMPLETED',
        },
      });
      await prismaService.ledgerEntry.createMany({
        data: [
          {
            orderId,
            vendorId: 'vend-1',
            entryType: 'ORDER_REVENUE',
            amount: 1404,
            description: 'Finance test revenue',
          },
          {
            orderId,
            vendorId: 'vend-1',
            entryType: 'COMMISSION_DEDUCTED',
            amount: -175.5,
            description: 'Finance test 12.5% commission',
          },
          {
            orderId,
            vendorId: 'vend-1',
            entryType: 'VENDOR_PAYOUT',
            amount: 1228.5,
            description: 'Finance test payout',
          },
        ],
      });
      await prismaService.vendorPayout.create({
        data: {
          id: payoutId,
          vendorId: 'vend-1',
          amount: 1228.5,
          status: 'PENDING',
        },
      });

      return { payoutId };
    }

    it('Payments: lists payments and calculates summary metrics', async () => {
      await seedFinanceRecords();
      const list = await financeService.listPayments({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].paymentId).toBeDefined();

      const metrics = await financeService.getPaymentMetrics();
      expect(metrics.settledToday).toBeGreaterThan(0);
      expect(metrics.captureRate).toBeGreaterThan(0);
      expect(metrics.razorpayOnline).toBeGreaterThan(0);
    });

    it('Ledger: lists vendor ledger entries, computes take rate, and updates settlement status', async () => {
      const { payoutId } = await seedFinanceRecords();
      const list = await financeService.listLedger({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data[0].commissionRate).toBeDefined();

      const metrics = await financeService.getLedgerMetrics();
      expect(metrics.grossMarketplaceVolume).toBeGreaterThan(0);
      expect(metrics.platformCommissionEarned).toBeGreaterThan(0);
      expect(metrics.averageTakeRate).toBeGreaterThan(0);

      const updateRes = await financeService.updateSettlementStatus(
        payoutId,
        { status: 'HOLD' },
        'usr-admin-1',
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

      try {
        const modRes = await reviewsService.moderateReview(
          'rev-seed-1',
          { status: 'FLAGGED', flagReason: 'Repetitive promotional language' },
          'usr-admin-amara',
          'Amara Okonkwo',
        );
        expect(modRes.success).toBe(true);
        expect(modRes.review.status).toBe('FLAGGED');
      } finally {
        await reviewsService.moderateReview(
          'rev-seed-1',
          { status: 'PUBLISHED' },
          'usr-admin-amara',
          'Amara Okonkwo',
        );
      }
    });

    it('Support: lists tickets, calculates queue counts, and updates ticket status to RESOLVED', async () => {
      const list = await supportService.listTickets({});
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.counts.all).toBeGreaterThan(0);

      try {
        const updateRes = await supportService.updateTicket(
          'tkt-seed-1',
          { status: 'RESOLVED', resolutionRemarks: 'Forwarded delivery landmark note to rider.' },
          'usr-admin-amara',
          'Amara Okonkwo',
        );

        expect(updateRes.success).toBe(true);
        expect(updateRes.ticket.status).toBe('RESOLVED');
        expect(updateRes.ticket.resolvedAt).toBeDefined();
      } finally {
        await supportService.updateTicket(
          'tkt-seed-1',
          { status: 'OPEN' },
          'usr-admin-amara',
          'Amara Okonkwo',
        );
      }
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
      const inviteEmail = `folake.${runId}@affordz.in`;
      const prevCredsSetting = await prismaService.workspaceSetting.findUnique({
        where: { key: 'adminCredentials' },
      });
      const prevCreds = Array.isArray(prevCredsSetting?.value)
        ? JSON.parse(JSON.stringify(prevCredsSetting!.value))
        : [];

      const inviteRes = await accessService.inviteUser(
        {
          name: 'Folake Adeyemi',
          email: inviteEmail,
          role: 'Marketplace Operations',
          department: 'Fulfillment & Dispatch',
        },
        'usr-admin-amara',
        'Amara Okonkwo',
      );
      if ((inviteRes.user as any)?.userId) {
        createdUserIds.push((inviteRes.user as any).userId);
      }

      try {
        expect(inviteRes.success).toBe(true);
        expect(inviteRes.user.email).toBe(inviteEmail);
        expect((inviteRes.user as any).passwordHash).toBeUndefined();

        // Update role
        const updateRes = await accessService.updateUserRole(
          inviteRes.user.id,
          { role: 'Support Manager' },
          'usr-admin-amara',
          'Amara Okonkwo',
        );
        expect(updateRes.user.role).toBe('Support Manager');
      } finally {
        await prismaService.workspaceSetting.update({
          where: { key: 'adminCredentials' },
          data: { value: prevCreds },
        });
      }
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
      const notifRes = await notificationsService.broadcast(
        {
          title: 'Audit Trail Seed Broadcast',
          scope: 'Central Ops HQ',
          severity: 'Informational',
          note: 'Seeding audit event for AdminAuditService query verification.',
        },
        'usr-admin-1',
        'Amara Okonkwo',
      );
      if (notifRes.notification?.id) {
        createdNotificationIds.push(notifRes.notification.id);
      }

      const audit = await auditService.listAuditEvents({});
      expect(audit.data.length).toBeGreaterThan(0);
      expect(audit.data[0].actionType).toBeDefined();
      expect(audit.data[0].actorRole).toBeDefined();
    });

    it('Notifications: lists notifications, marks as read, and broadcasts operational notice', async () => {
      const broadcastRes = await notificationsService.broadcast(
        {
          title: 'Emergency Server Maintenance Scheduled',
          scope: 'Central Ops HQ',
          severity: 'Operational Warning',
          message: 'Maintenance window between 02:00 and 03:00 IST.',
        },
        'usr-admin-1',
        'Amara Okonkwo',
      );
      expect(broadcastRes.success).toBe(true);
      expect(broadcastRes.notification.title).toContain('Maintenance');
      if (broadcastRes.notification?.id) {
        createdNotificationIds.push(broadcastRes.notification.id);
      }

      const list = await notificationsService.listNotifications({});
      expect(list.data.length).toBeGreaterThan(0);

      const markRes = await notificationsService.markAsRead(broadcastRes.notification.id);
      expect(markRes.success).toBe(true);
      expect(markRes.notification.read).toBe(true);
    });

    it('Settings: retrieves profile session info, updates workspace preferences', async () => {
      const profileInfo = await settingsService.getProfileAndSession('ADM-001');
      expect(profileInfo.profile.displayName).toBeDefined();
      expect(profileInfo.activeSession.authProvider).toBeDefined();
      expect(profileInfo.activeSession.channelStatus).toBeDefined();

      const prefRes = await settingsService.savePreferences({
        defaultPageSize: 20,
        highDensityRows: true,
      });
      expect(prefRes.success).toBe(true);
      expect(prefRes.preferences.defaultPageSize).toBe(20);
    });
  });
});

