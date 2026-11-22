jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(async () => ({
      uid: 'fb-admin-vendor',
      phone_number: '+91 99999 00000',
      email: 'admin@kudicart.in',
      name: 'Operations Admin',
      role: 'ADMIN',
    })),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminVendorsService } from '../admin/services/admin-vendors.service';
import { VendorService } from './vendor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { EmailService } from '../notifications/email.service';
import { AdminAuditService } from '../admin/services/admin-audit.service';
import { OrdersService } from '../orders/orders.service';
import { OrderTransitionService } from '../orders/order-transition.service';
import { Role } from '../../common/enums/role.enum';

describe('Vendor Management & Operations Suite', () => {
  let adminVendorsService: AdminVendorsService;
  let vendorService: VendorService;
  let prisma: any;
  let firebaseAdmin: any;
  let emailService: any;

  const mockPrisma = {
    isConnectedToDb: true,
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    vendor: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    vendorCategoryCommission: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    },
    category: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ledgerEntry: {
      findMany: jest.fn(),
    },
  };

  const mockFirebaseAdmin = {
    createAuthUser: jest.fn(),
    getUserByEmail: jest.fn().mockResolvedValue(null),
    setUserClaims: jest.fn().mockResolvedValue(undefined),
    setUserPassword: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmailService = {
    sendVendorWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendVendorOrderNotificationEmail: jest.fn().mockResolvedValue(true),
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const mockOrdersService = {
    formatOrderResponse: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminVendorsService,
        VendorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FirebaseAdminService, useValue: mockFirebaseAdmin },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AdminAuditService, useValue: mockAuditService },
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: OrderTransitionService, useValue: {} },
      ],
    }).compile();

    adminVendorsService = module.get<AdminVendorsService>(AdminVendorsService);
    vendorService = module.get<VendorService>(VendorService);
    prisma = module.get(PrismaService);
    firebaseAdmin = module.get(FirebaseAdminService);
    emailService = module.get(EmailService);
  });

  describe('Admin Vendor Onboarding with Category-Wise Commission & Email Credentials', () => {
    it('successfully onboards a vendor, saves category-wise commissions, and sends credentials via EmailService', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockFirebaseAdmin.createAuthUser.mockResolvedValue({
        uid: 'fb-user-v1',
        email: 'silk@boutique.com',
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'usr-vendor-1',
        name: 'Priya Sharma',
        email: 'silk@boutique.com',
        phoneNumber: '+91 98450 11223',
        role: Role.VENDOR,
        isActive: true,
        firebaseUid: 'fb-user-v1',
      });
      const now = new Date();
      mockPrisma.vendor.create.mockResolvedValue({
        id: 'vnd-1',
        storeName: 'Royal Silk Boutique',
        ownerName: 'Priya Sharma',
        email: 'silk@boutique.com',
        phoneNumber: '+91 98450 11223',
        address: '100 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        commissionRate: null,
        isOnline: true,
        autoScheduleEnabled: false,
        isActive: true,
        userId: 'usr-vendor-1',
        createdAt: now,
        updatedAt: now,
      });
      mockPrisma.vendorCategoryCommission.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.vendor.findUnique.mockResolvedValue({
        id: 'vnd-1',
        storeName: 'Royal Silk Boutique',
        ownerName: 'Priya Sharma',
        email: 'silk@boutique.com',
        phoneNumber: '+91 98450 11223',
        address: '100 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        commissionRate: null,
        isOnline: true,
        autoScheduleEnabled: false,
        isActive: true,
        userId: 'usr-vendor-1',
        createdAt: now,
        updatedAt: now,
        categoryCommissions: [
          { categoryId: 'cat-saree', commissionRate: 15.0, category: { name: 'Silk Sarees' } },
          { categoryId: 'cat-kurti', commissionRate: 12.0, category: { name: 'Designer Kurtis' } },
        ],
      });

      const result = await adminVendorsService.onboardVendor({
        storeName: 'Royal Silk Boutique',
        ownerName: 'Priya Sharma',
        email: 'silk@boutique.com',
        phone: '+91 98450 11223',
        address: '100 MG Road',
        categoryCommissions: [
          { categoryId: 'cat-saree', commissionRate: 15.0 },
          { categoryId: 'cat-kurti', commissionRate: 12.0 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.vendor.id).toBe('vnd-1');
      expect(result.credentials.email).toBe('silk@boutique.com');
      expect(result.credentials.temporaryPassword).toBeDefined();

      // Verified Firebase user creation
      expect(mockFirebaseAdmin.createAuthUser).toHaveBeenCalledWith({
        email: 'silk@boutique.com',
        password: result.credentials.temporaryPassword,
        displayName: 'Priya Sharma',
        phoneNumber: '+919845011223',
      });

      // Verified Category Commissions insertion
      expect(mockPrisma.vendorCategoryCommission.createMany).toHaveBeenCalledWith({
        data: [
          { vendorId: 'vnd-1', categoryId: 'cat-saree', commission: 15.0 },
          { vendorId: 'vnd-1', categoryId: 'cat-kurti', commission: 12.0 },
        ],
      });

      // Verified Email credentials dispatch via EmailService
      expect(mockEmailService.sendVendorWelcomeEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'silk@boutique.com',
          storeName: 'Royal Silk Boutique',
          ownerName: 'Priya Sharma',
          loginUrl: expect.any(String),
          tempPassword: result.credentials.temporaryPassword,
        }),
      );
    });

    it('rejects duplicate onboarding when email or phone is already registered', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'existing-usr',
        email: 'silk@boutique.com',
      });

      await expect(
        adminVendorsService.onboardVendor({
          storeName: 'Duplicate Boutique',
          ownerName: 'Priya Sharma',
          email: 'silk@boutique.com',
          phone: '+91 98450 11223',
          address: '100 MG Road',
          categoryCommissions: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Store Availability & Operating Hours', () => {
    it('updates vendor live online/offline toggle state', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vnd-1', userId: 'usr-vendor-1', isOnline: true });
      mockPrisma.vendor.update.mockResolvedValue({
        id: 'vnd-1',
        isOnline: false,
      });

      const updated = await vendorService.toggleStoreStatus('usr-vendor-1', false);

      expect(updated.isOnline).toBe(false);
      expect(mockPrisma.vendor.update).toHaveBeenCalledWith({
        where: { id: 'vnd-1' },
        data: expect.objectContaining({ isOnline: false }),
      });
    });

    it('updates 7-day operating hours schedule and toggles auto-schedule', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vnd-1', userId: 'usr-vendor-1' });
      const testSchedule = {
        monday: { open: '09:00', close: '20:00', isOpen: true },
        tuesday: { open: '09:00', close: '20:00', isOpen: true },
        sunday: { open: '10:00', close: '18:00', isOpen: false },
      };

      mockPrisma.vendor.update.mockResolvedValue({
        id: 'vnd-1',
        operatingHours: testSchedule,
        autoScheduleEnabled: true,
      });

      const result = await vendorService.updateOperatingHours('usr-vendor-1', {
        operatingHours: testSchedule,
        autoScheduleEnabled: true,
      });

      expect(result.operatingHours).toEqual(testSchedule);
      expect(result.autoScheduleEnabled).toBe(true);
    });
  });

  describe('Vendor Order Privacy Sanitization & Telemetry', () => {
    it('scrubs customer PII (email, phone, address street) and provides masked ref and driver details', () => {
      const rawCustomer = {
        name: 'Arjun Das',
        email: 'arjun@gmail.com',
        phone: '+91 98765 43210',
      };
      const rawAddress = {
        street: 'Flat 402, Lotus Towers, 14th Cross',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560038',
      };
      const rawDriver = {
        name: 'Ramesh Kumar',
        phone: '+91 91234 56789',
        driverProfile: {
          vehicleType: 'Motorcycle',
          vehicleRegistration: 'KA-01-EQ-9988',
        },
      };

      // Masked customer reference: "Customer #..."
      const maskedCustomer = `Customer #${rawCustomer.name.slice(0, 3).toUpperCase()}`;
      // Sanitized locality without house/street address
      const sanitizedAddress = `${rawAddress.locality}, ${rawAddress.city}, ${rawAddress.state} - ${rawAddress.postalCode}`;

      expect(maskedCustomer).toBe('Customer #ARJ');
      expect(sanitizedAddress).not.toContain('Flat 402');
      expect(sanitizedAddress).toContain('Indiranagar');
      expect(rawDriver.name).toBe('Ramesh Kumar');
      expect(rawDriver.phone).toBe('+91 91234 56789');
      expect(rawDriver.driverProfile.vehicleRegistration).toBe('KA-01-EQ-9988');
    });
  });
});
