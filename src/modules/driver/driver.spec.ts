jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  cert: jest.fn(),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(async () => ({
      uid: 'fb-user-123',
      phone_number: '+91 98450 12890',
      email: 'customer@affordz.in',
      name: 'Ananya Sharma',
    })),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, ConflictException, UnauthorizedException, HttpException } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DriverAuthService } from './driver-auth.service';
import { DriverProfileService } from './driver-profile.service';
import { DriverShiftsService } from './driver-shifts.service';
import { DriverEarningsService } from './driver-earnings.service';
import { DriverNotificationsService } from './driver-notifications.service';
import { DriverOrdersService } from './driver-orders.service';
import { DriverTryAndBuyService } from './driver-try-and-buy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Reflector } from '@nestjs/core';
import { Role } from '../../common/enums/role.enum';
import { deriveCustomerOrderOtp, hashOrderOtp } from '../orders/order-otp.util';

describe('KudiCart Driver Partner Backend — Complete Domain & Security Test Suite', () => {
  let moduleRef: TestingModule;
  let authService: DriverAuthService;
  let profileService: DriverProfileService;
  let shiftsService: DriverShiftsService;
  let earningsService: DriverEarningsService;
  let notificationsService: DriverNotificationsService;
  let ordersService: DriverOrdersService;
  let tryAndBuyService: DriverTryAndBuyService;
  let prismaService: PrismaService;

  const runId = `drvspec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.init();

    authService = moduleRef.get<DriverAuthService>(DriverAuthService);
    profileService = moduleRef.get<DriverProfileService>(DriverProfileService);
    shiftsService = moduleRef.get<DriverShiftsService>(DriverShiftsService);
    earningsService = moduleRef.get<DriverEarningsService>(DriverEarningsService);
    notificationsService = moduleRef.get<DriverNotificationsService>(DriverNotificationsService);
    ordersService = moduleRef.get<DriverOrdersService>(DriverOrdersService);
    tryAndBuyService = moduleRef.get<DriverTryAndBuyService>(DriverTryAndBuyService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    if (createdNotificationIds.length > 0) {
      await prismaService.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      });
      createdNotificationIds.length = 0;
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
    if (createdProductIds.length > 0) {
      await prismaService.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
      createdProductIds.length = 0;
    }
    if (createdAddressIds.length > 0) {
      await prismaService.address.deleteMany({
        where: { id: { in: createdAddressIds } },
      });
      createdAddressIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
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
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('1. Driver Authentication & Account Lifecycle', () => {
    it('generates secure 6-digit OTP and verifies valid code', async () => {
      const sendRes = await authService.sendOtp('+91 98765 43210');
      expect(sendRes.success).toBe(true);
      expect(sendRes.message).toMatch(/(OTP sent successfully|Verification OTP generated|Verification OTP dispatched)/);

      const otpCode = authService.getOtpForTesting('+91 98765 43210')!;
      expect(otpCode).toMatch(/^\d{6}$/);

      const verifyRes = await authService.verifyOtp('+91 98765 43210', otpCode);
      expect(verifyRes.token).toBeDefined();
      expect(verifyRes.role).toBe(Role.DRIVER);
      expect(verifyRes.user.driverId).toBe('drv-1');
    });

    it('blocks getOtpForTesting in production environment', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(() => authService.getOtpForTesting('9876543210')).toThrow(UnauthorizedException);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('enforces both per-phone and per-IP rate limiting', () => {
      RateLimitGuard.resetAll();
      const reflector = new Reflector();
      const guard = new RateLimitGuard(reflector);

      // Mock reflector returning limit of 2 requests per 60 seconds
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ points: 2, duration: 60 });

      const createMockContext = (ip: string, phone?: string) =>
        ({
          getHandler: () => ({ name: 'sendOtp' }),
          getClass: () => ({ name: 'DriverAuthController' }),
          switchToHttp: () => ({
            getRequest: () => ({
              headers: { 'x-forwarded-for': ip },
              body: phone ? { phone } : {},
            }),
            getResponse: () => ({ setHeader: jest.fn() }),
          }),
        } as any);

      // 1st request from IP 1 with phone 9876543210 -> allowed
      expect(guard.canActivate(createMockContext('1.2.3.4', '9876543210'))).toBe(true);
      // 2nd request from IP 1 with phone 9876543210 -> allowed
      expect(guard.canActivate(createMockContext('1.2.3.4', '9876543210'))).toBe(true);
      // 3rd request from IP 1 with different phone -> blocked by IP rate limit
      expect(() => guard.canActivate(createMockContext('1.2.3.4', '9999988888'))).toThrow(HttpException);

      // Request from IP 2 with phone 9876543210 -> blocked by PHONE rate limit
      expect(() => guard.canActivate(createMockContext('5.6.7.8', '9876543210'))).toThrow(HttpException);
    });

    it('rejects invalid numbers like 1234567890, non-Indian prefixes, and repeated digits', async () => {
      const canonicalMsg = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
      await expect(authService.sendOtp('1234567890')).rejects.toThrow(canonicalMsg);
      await expect(authService.sendOtp('+91 1234567890')).rejects.toThrow(canonicalMsg);
      await expect(authService.sendOtp('+91 5555555555')).rejects.toThrow(canonicalMsg);
      await expect(authService.sendOtp('+91 9999999999')).rejects.toThrow(canonicalMsg);
      await expect(authService.sendOtp('9876')).rejects.toThrow(canonicalMsg);
    });

    it('rejects invalid OTP attempts', async () => {
      await authService.sendOtp('+91 98765 43210');
      await expect(
        authService.verifyOtp('+91 98765 43210', '000000'),
      ).rejects.toThrow();
    });

    it('returns authoritative driver account and onboarding status', async () => {
      const status = await authService.getAccountStatus('drv-1');
      expect(status.driverId).toBe('drv-1');
      expect(status.kycStatus).toBe('APPROVED');
      expect(status.isApproved).toBe(true);
    });
  });

  describe('2. Driver Profile & KYC Security', () => {
    it('masks Aadhaar number in responses and prevents self-approval of KYC', async () => {
      const seededProfile = await profileService.getProfile('drv-1');
      expect(seededProfile.kycStatus).toBe('APPROVED');

      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_prof_u_${suffix}`;
      const profId = `${runId}_prof_d_${suffix}`;
      createdUserIds.push(userId);
      createdDriverProfileIds.push(profId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: 'Temp Rider',
          email: `${userId}@test.kudicart.in`,
          phone: `+919822${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: profId,
          userId,
          fullName: 'Temp Rider',
          phone: `+919822${Math.floor(100000 + Math.random() * 899999)}`,
          aadhaarNumber: '123456789012',
          kycStatus: 'PENDING',
        },
      });

      const profile = await profileService.getProfile(profId);
      expect(profile.aadhaarNumber).toContain('XXXX-XXXX-9012');
      expect(profile.kycStatus).toBe('PENDING');

      const updated = await profileService.updateDetails(profId, {
        fullName: 'Rajesh Kumar Updated',
      });
      expect(updated.fullName).toBe('Rajesh Kumar Updated');
      expect(updated.kycStatus).toBe('PENDING');
    });

    it('validates document uploads for format and size limits', async () => {
      await expect(
        profileService.uploadDocument('drv-1', {
          docType: 'aadhaar',
          side: 'front',
          fileUri: 'file:///hack.exe',
          fileName: 'malware.exe',
          fileSize: '1.2 MB',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        profileService.uploadDocument('drv-1', {
          docType: 'aadhaar',
          side: 'front',
          fileUri: 'file:///huge_doc.pdf',
          fileName: 'huge_doc.pdf',
          fileSize: '12.5 MB',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks unapproved drivers from toggling online availability', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_kyc_u_${suffix}`;
      const profId = `${runId}_kyc_d_${suffix}`;
      createdUserIds.push(userId);
      createdDriverProfileIds.push(profId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: 'Unapproved Rider',
          email: `${userId}@test.kudicart.in`,
          phone: `+919823${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: profId,
          userId,
          fullName: 'Unapproved Rider',
          phone: `+919823${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'PENDING',
        },
      });

      await expect(profileService.updateAvailability(profId, true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires PAN front side for KYC submission and does not mandate non-existent PAN back', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_pan_u_${suffix}`;
      const profId = `${runId}_pan_d_${suffix}`;
      createdUserIds.push(userId);
      createdDriverProfileIds.push(profId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: 'PAN Test Rider',
          email: `${userId}@test.kudicart.in`,
          phone: `+919824${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: profId,
          userId,
          fullName: 'PAN Test Rider',
          phone: `+919824${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'PENDING',
        },
      });

      // Missing PAN front causes rejection
      await expect(profileService.submitKyc(profId)).rejects.toThrow(BadRequestException);

      // Uploading PAN front (no PAN back needed) enables submission -> UNDER_REVIEW
      await profileService.uploadDocument(profId, {
        docType: 'pan',
        side: 'front',
        fileUri: 'https://example.com/pan_front.jpg',
        fileName: 'pan_front.jpg',
        fileSize: '1.1 MB',
      });

      const res = await profileService.submitKyc(profId);
      expect(res.success).toBe(true);
      expect(res.kycStatus).toBe('UNDER_REVIEW');
    });
  });

  describe('3. Shifts & Part-Time Slot Concurrency Control', () => {
    it('lists full-time weekly schedule and assigned shift', async () => {
      const shifts = await shiftsService.getShifts();
      expect(shifts.weekSchedule.length).toBeGreaterThan(0);
      expect(shifts.todayShift).toBeDefined();
    });

    it('prevents duplicate bookings and enforces slot capacity concurrency locks', async () => {
      const bookRes = await shiftsService.bookSlot('drv-1', 'tw_mon1');
      expect(bookRes.success).toBe(true);
      expect(bookRes.slot.id).toBe('tw_mon1');

      // Duplicate booking attempt throws ConflictException
      await expect(shiftsService.bookSlot('drv-1', 'tw_mon1')).rejects.toThrow(
        ConflictException,
      );

      // Cancel booking safely
      const cancelRes = await shiftsService.cancelSlot('drv-1', 'tw_mon1');
      expect(cancelRes.success).toBe(true);
    });

    it('prevents booking locked next-week slots before Friday 06:00 PM', async () => {
      const slots = await shiftsService.getSlots('drv-1', 'NEXT_WEEK');
      expect(slots.isLocked).toBe(true);
      expect(slots.lockMessage).toContain('locked until Friday');
    });
  });

  describe('4. Earnings, Multi-Milestone Bonuses & Surges', () => {
    it('retrieves weekly breakdown with authoritative daily totals', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const drvUserId = `${runId}_earn_u_${suffix}`;
      const drvProfId = `${runId}_earn_p_${suffix}`;
      const addrId = `${runId}_earn_addr_${suffix}`;
      const orderId = `${runId}_earn_ord_${suffix}`;
      createdUserIds.push(drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      const drvPhone = `+919821${Math.floor(100000 + Math.random() * 899999)}`;
      await prismaService.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: 'Earnings Rider',
          email: `${drvUserId}@test.kudicart.in`,
          phone: drvPhone,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: 'Earnings Rider',
          phone: drvPhone,
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
          latitude: 12.9784,
          longitude: 77.6408,
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-ERN-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          driverId: drvUserId,
          driverProfileId: drvProfId,
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          status: 'DELIVERED',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'COMPLETED',
          deliveredAt: new Date(),
          itemTotal: 500,
          taxes: 25,
          grandTotal: 525,
        },
      });

      const earnings = await earningsService.getEarnings(drvProfId, 0);
      expect(earnings.totalEarnings).toBe(55);
      expect(earnings.deliveries).toBe(1);
      expect(earnings.days.length).toBe(7);
      expect(earnings.days[0].dayName).toBeDefined();
    });

    it('evaluates multi-milestone bonus progress and active surge incentives', async () => {
      const bonus = await earningsService.getBonusProgress('drv-1');
      expect(bonus.dailyBonus.milestones.length).toBe(3);
      expect(bonus.weeklyBonus.milestones.length).toBe(3);

      const surges = await earningsService.getSurges();
      expect(surges.count).toBeGreaterThan(0);
      expect(surges.activeSurges[0].bonusAmount).toBeGreaterThan(0);
    });
  });

  describe('5. Notifications & Security Ownership', () => {
    it('enforces ownership: driver cannot delete another driver notification', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userA = `${runId}_notifA_${suffix}`;
      const profA = `${runId}_notifPA_${suffix}`;
      const userB = `${runId}_notifB_${suffix}`;
      const notifAId = `${runId}_nA_${suffix}`;
      const notifBId = `${runId}_nB_${suffix}`;
      createdUserIds.push(userA, userB);
      createdDriverProfileIds.push(profA);
      createdNotificationIds.push(notifAId, notifBId);

      await prismaService.user.createMany({
        data: [
          {
            id: userA,
            firebaseUid: `fb_${userA}`,
            name: 'Driver A',
            email: `${userA}@test.kudicart.in`,
            phone: `+919825${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'DRIVER',
            status: 'ACTIVE',
          },
          {
            id: userB,
            firebaseUid: `fb_${userB}`,
            name: 'Driver B',
            email: `${userB}@test.kudicart.in`,
            phone: `+919826${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'DRIVER',
            status: 'ACTIVE',
          },
        ],
      });
      await prismaService.driverProfile.create({
        data: {
          id: profA,
          userId: userA,
          fullName: 'Driver A',
          phone: `+919825${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
        },
      });
      await prismaService.notification.createMany({
        data: [
          {
            id: notifAId,
            userId: userA,
            role: 'DRIVER',
            category: 'SYSTEM',
            title: 'Shift Reminder',
            body: 'Your Indiranagar shift begins shortly.',
            isRead: false,
          },
          {
            id: notifBId,
            userId: userB,
            role: 'DRIVER',
            category: 'SYSTEM',
            title: 'Secret',
            body: 'Confidential',
            isRead: false,
          },
        ],
      });

      const list = await notificationsService.getNotifications(profA);
      expect(list.notifications.length).toBeGreaterThan(0);

      const readRes = await notificationsService.markAsRead(profA, notifAId);
      expect(readRes.success).toBe(true);

      await expect(
        notificationsService.deleteNotification(profA, notifBId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('6. Standard Delivery Lifecycle', () => {
    it('enforces assigned driver ownership on pickup and delivery transitions', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const authUserId = `${runId}_del_u1_${suffix}`;
      const authProfId = `${runId}_del_p1_${suffix}`;
      const unauthUserId = `${runId}_del_u2_${suffix}`;
      const unauthProfId = `${runId}_del_p2_${suffix}`;
      const addrId = `${runId}_del_addr_${suffix}`;
      const orderId = `${runId}_del_ord_${suffix}`;
      createdUserIds.push(authUserId, unauthUserId);
      createdDriverProfileIds.push(authProfId, unauthProfId);
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.user.createMany({
        data: [
          {
            id: authUserId,
            firebaseUid: `fb_${authUserId}`,
            name: 'Authorized Rider',
            email: `${authUserId}@test.kudicart.in`,
            phone: `+919827${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'DRIVER',
            status: 'ACTIVE',
          },
          {
            id: unauthUserId,
            firebaseUid: `fb_${unauthUserId}`,
            name: 'Unauthorized Rider',
            email: `${unauthUserId}@test.kudicart.in`,
            phone: `+919828${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'DRIVER',
            status: 'ACTIVE',
          },
        ],
      });
      await prismaService.driverProfile.createMany({
        data: [
          {
            id: authProfId,
            userId: authUserId,
            fullName: 'Authorized Rider',
            phone: `+919827${Math.floor(100000 + Math.random() * 899999)}`,
            kycStatus: 'APPROVED',
            isOnline: true,
          },
          {
            id: unauthProfId,
            userId: unauthUserId,
            fullName: 'Unauthorized Rider',
            phone: `+919828${Math.floor(100000 + Math.random() * 899999)}`,
            kycStatus: 'APPROVED',
            isOnline: true,
          },
        ],
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
          latitude: 12.9784,
          longitude: 77.6408,
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-STD-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          driverId: authUserId,
          driverProfileId: authProfId,
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          status: 'ASSIGNED',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          itemTotal: 1200,
          taxes: 60,
          grandTotal: 1260,
        },
      });

      // Unauthorized driver cannot pickup
      await expect(ordersService.pickupOrder(unauthProfId, orderId)).rejects.toThrow(
        ForbiddenException,
      );

      // Authorized driver completes Pickup -> Out for Delivery -> Arrived (status stays OUT_FOR_DELIVERY per DCR-005) -> Deliver
      const pickup = await ordersService.pickupOrder(authProfId, orderId);
      expect(pickup.order.status).toBe('PICKED_UP');

      const out = await ordersService.outForDelivery(authProfId, orderId);
      expect(out.order.status).toBe('OUT_FOR_DELIVERY');

      const arrived = await ordersService.markArrived(authProfId, orderId);
      expect(arrived.success).toBe(true);
      expect(arrived.arrivedAt).toBeTruthy();

      const delivered = await ordersService.deliverOrder(authProfId, orderId, {
        cashCollected: true,
      });
      expect(delivered.order.status).toBe('DELIVERED');
      expect(delivered.order.paymentStatus).toBe('COMPLETED');
    });
  });

  describe('7. Try & Buy Complete State Machine & Financial Settlement', () => {
    it('executes full Try & Buy lifecycle: handover OTP -> Keep/Return -> Collect -> Payment -> Reconciliation', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const drvUserId = `${runId}_tnb_u_${suffix}`;
      const drvProfId = `${runId}_tnb_p_${suffix}`;
      const addrId = `${runId}_tnb_addr_${suffix}`;
      const prodKeepId = `${runId}_tnb_pk_${suffix}`;
      const prodReturnId = `${runId}_tnb_pr_${suffix}`;
      const orderId = `${runId}_tnb_ord_${suffix}`;
      createdUserIds.push(drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdAddressIds.push(addrId);
      createdProductIds.push(prodKeepId, prodReturnId);
      createdOrderIds.push(orderId);

      await prismaService.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: 'TryBuy Rider',
          email: `${drvUserId}@test.kudicart.in`,
          phone: `+919829${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: 'TryBuy Rider',
          phone: `+919829${Math.floor(100000 + Math.random() * 899999)}`,
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
          latitude: 12.9784,
          longitude: 77.6408,
        },
      });
      await prismaService.product.createMany({
        data: [
          {
            id: prodKeepId,
            title: `Keep Kurti ${suffix}`,
            brand: 'KudiCart Atelier',
            description: 'Keep item',
            vendorId: 'vend-1',
            categoryId: 'cat-1',
            price: 1000,
            originalPrice: 1200,
            discount: '17% OFF',
            sizes: ['M'],
            image: 'https://example.com/k.jpg',
            altText: 'Keep Kurti',
            galleryImages: [],
            stockQuantity: 10,
            fulfillmentType: 'DARK_STORE',
          },
          {
            id: prodReturnId,
            title: `Return Kurti ${suffix}`,
            brand: 'KudiCart Atelier',
            description: 'Return item',
            vendorId: 'vend-1',
            categoryId: 'cat-1',
            price: 600,
            originalPrice: 800,
            discount: '25% OFF',
            sizes: ['L'],
            image: 'https://example.com/r.jpg',
            altText: 'Return Kurti',
            galleryImages: [],
            stockQuantity: 10,
            fulfillmentType: 'DARK_STORE',
          },
        ],
      });

      const otp = deriveCustomerOrderOtp(orderId);
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-TNB-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          driverId: drvUserId,
          driverProfileId: drvProfId,
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road',
            city: 'Bengaluru',
          },
          fulfillmentType: 'DARK_STORE',
          isTryAndBuy: true,
          status: 'OUT_FOR_DELIVERY',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          deliveryOtpHash: hashOrderOtp(orderId, otp),
          itemTotal: 1600,
          taxes: 80,
          grandTotal: 1680,
        },
      });

      const itemKeep = await prismaService.orderItem.create({
        data: {
          orderId,
          productId: prodKeepId,
          title: `Keep Kurti ${suffix}`,
          brand: 'KudiCart Atelier',
          size: 'M',
          price: 1000,
          quantity: 1,
          image: 'https://example.com/k.jpg',
        },
      });
      const itemReturn = await prismaService.orderItem.create({
        data: {
          orderId,
          productId: prodReturnId,
          title: `Return Kurti ${suffix}`,
          brand: 'KudiCart Atelier',
          size: 'L',
          price: 600,
          quantity: 1,
          image: 'https://example.com/r.jpg',
        },
      });

      // 1. Handover OTP Verification (4-digit customer OTP)
      const handoverRes = await tryAndBuyService.confirmHandover(drvProfId, orderId, {
        otp,
      });
      expect(handoverRes.success).toBe(true);

      // 2. Customer confirms selections (Keep 1 item, Return 1 item)
      const selectionsRes = await tryAndBuyService.recordSelections(drvProfId, orderId, {
        selections: {
          [itemKeep.id]: 'KEEP',
          [itemReturn.id]: 'RETURN',
        },
      });
      expect(selectionsRes.success).toBe(true);
      expect(selectionsRes.keptCount).toBe(1);
      expect(selectionsRes.returnedCount).toBe(1);
      expect(selectionsRes.finalPayableTotal).toBeGreaterThan(0);

      // 3. Collect return item
      const collectionRes = await tryAndBuyService.confirmReturnCollection(drvProfId, orderId, {
        collectedItemIds: [itemReturn.id],
      });
      expect(collectionRes.success).toBe(true);

      // 4. Settle payment for kept item -> transitions to RETURNING due to returned item
      const paymentRes = await tryAndBuyService.settlePayment(drvProfId, orderId, {
        cashCollected: true,
      });
      expect(paymentRes.success).toBe(true);
      expect(paymentRes.orderStatus).toBe('RETURNING');

      // 5. Store return flow verification
      const storeArrival = await tryAndBuyService.arriveAtStore(drvProfId, orderId);
      expect(storeArrival.success).toBe(true);

      const reconRes = await tryAndBuyService.reconcileStoreReturn(drvProfId, orderId, {
        supervisorConfirmed: true,
        note: 'Items verified in darkstore inventory',
      });
      expect(reconRes.success).toBe(true);
    });
  });

  describe('8. Security, RBAC & Rate Limiting Guard', () => {
    it('RateLimitGuard rejects requests exceeding configured threshold with 429 Too Many Requests', () => {
      const reflector = new Reflector();
      const guard = new RateLimitGuard(reflector);

      jest.spyOn(reflector, 'get').mockReturnValue({ points: 2, duration: 60 });

      const mockRequest: any = {
        headers: {},
        ip: '192.168.1.100',
        user: { id: 'usr-rate-test' },
      };
      const mockContext: any = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      expect(guard.canActivate(mockContext)).toBe(true);
      expect(guard.canActivate(mockContext)).toBe(true);
      expect(() => guard.canActivate(mockContext)).toThrow();
    });
  });
});
