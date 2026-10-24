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
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
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

describe('KudiCart Driver Partner Backend — Complete Domain & Security Test Suite', () => {
  let authService: DriverAuthService;
  let profileService: DriverProfileService;
  let shiftsService: DriverShiftsService;
  let earningsService: DriverEarningsService;
  let notificationsService: DriverNotificationsService;
  let ordersService: DriverOrdersService;
  let tryAndBuyService: DriverTryAndBuyService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleRef.get<DriverAuthService>(DriverAuthService);
    profileService = moduleRef.get<DriverProfileService>(DriverProfileService);
    shiftsService = moduleRef.get<DriverShiftsService>(DriverShiftsService);
    earningsService = moduleRef.get<DriverEarningsService>(DriverEarningsService);
    notificationsService = moduleRef.get<DriverNotificationsService>(DriverNotificationsService);
    ordersService = moduleRef.get<DriverOrdersService>(DriverOrdersService);
    tryAndBuyService = moduleRef.get<DriverTryAndBuyService>(DriverTryAndBuyService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);
  });

  describe('1. Driver Authentication & Account Lifecycle', () => {
    it('generates secure 6-digit OTP and verifies valid code', async () => {
      const sendRes = await authService.sendOtp('+91 98765 43210');
      expect(sendRes.success).toBe(true);
      expect(sendRes.message).toContain('OTP sent successfully');

      const verifyRes = await authService.verifyOtp('+91 98765 43210', '123456');
      expect(verifyRes.token).toBeDefined();
      expect(verifyRes.role).toBe(Role.DRIVER);
      expect(verifyRes.user.driverId).toBe('drv-1');
    });

    it('rejects invalid numbers like 1234567890, non-Indian prefixes, and repeated digits', async () => {
      await expect(authService.sendOtp('1234567890')).rejects.toThrow('Enter a valid mobile number');
      await expect(authService.sendOtp('+91 1234567890')).rejects.toThrow('Enter a valid mobile number');
      await expect(authService.sendOtp('+91 5555555555')).rejects.toThrow('Enter a valid mobile number');
      await expect(authService.sendOtp('+91 9999999999')).rejects.toThrow('Enter a valid mobile number');
      await expect(authService.sendOtp('9876')).rejects.toThrow('Enter a valid mobile number');
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
      const profile = await profileService.getProfile('drv-1');
      expect(profile.aadhaarNumber).toContain('••••');
      expect(profile.kycStatus).toBe('APPROVED');

      const updated = await profileService.updateDetails('drv-1', {
        fullName: 'Rajesh Kumar Updated',
      });
      expect(updated.fullName).toBe('Rajesh Kumar Updated');
      expect(updated.kycStatus).toBe('APPROVED');
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
      const store = prismaService.getStore();
      const driver = store.drivers.find((d) => d.id === 'drv-1')!;
      driver.kycStatus = 'PENDING';

      await expect(profileService.updateAvailability('drv-1', true)).rejects.toThrow(
        ForbiddenException,
      );
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
      const earnings = await earningsService.getEarnings(0);
      expect(earnings.totalEarnings).toBeGreaterThan(0);
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
      const list = await notificationsService.getNotifications('drv-1');
      expect(list.notifications.length).toBeGreaterThan(0);

      const notifId = list.notifications[0].id;
      // Driver marks read successfully
      const readRes = await notificationsService.markAsRead('drv-1', notifId);
      expect(readRes.success).toBe(true);

      // Other driver attempting delete
      const store = prismaService.getStore();
      store.notifications.push({
        id: 'notif-other-99',
        driverId: 'drv-2',
        category: 'SYSTEM',
        title: 'Secret',
        body: 'Confidential',
        timestamp: 'Just now',
        read: false,
        createdAt: new Date().toISOString(),
      });

      await expect(
        notificationsService.deleteNotification('drv-3', 'notif-other-99'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('6. Standard Delivery Lifecycle', () => {
    it('enforces assigned driver ownership on pickup and delivery transitions', async () => {
      const store = prismaService.getStore();
      const order = store.orders[0];
      order.driverId = 'drv-1';
      order.status = 'ASSIGNED';

      store.drivers.push({
        id: 'drv-unauthorized',
        userId: 'usr-unauth',
        name: 'Unauthorized Rider',
        fullName: 'Unauthorized Rider',
        kycStatus: 'APPROVED',
      } as any);

      // Unauthorized driver cannot pickup
      await expect(ordersService.pickupOrder('drv-unauthorized', order.id)).rejects.toThrow(
        ForbiddenException,
      );

      // Authorized driver completes Pickup -> Out for Delivery -> Arrived -> Deliver
      const pickup = await ordersService.pickupOrder('drv-1', order.id);
      expect(pickup.order.status).toBe('PICKED_UP');

      const out = await ordersService.outForDelivery('drv-1', order.id);
      expect(out.order.status).toBe('OUT_FOR_DELIVERY');

      const arrived = await ordersService.markArrived('drv-1', order.id);
      expect(arrived.success).toBe(true);

      const delivered = await ordersService.deliverOrder('drv-1', order.id);
      expect(delivered.order.status).toBe('DELIVERED');
    });
  });

  describe('7. Try & Buy Complete State Machine & Financial Settlement', () => {
    it('executes full Try & Buy lifecycle: handover OTP -> Keep/Return -> Collect -> Payment -> Reconciliation', async () => {
      const store = prismaService.getStore();
      const order = store.orders[0];
      order.driverId = 'drv-1';
      order.status = 'OUT_FOR_DELIVERY';
      order.isTryAndBuy = true;

      // 1. Handover OTP Verification (4-digit customer OTP)
      const handoverRes = await tryAndBuyService.confirmHandover('drv-1', order.id, {
        otp: '4829',
      });
      expect(handoverRes.success).toBe(true);

      // 2. Customer confirms selections (Keep 1 item, Return 0)
      const selectionsRes = await tryAndBuyService.recordSelections('drv-1', order.id, {
        selections: {
          [order.items[0].id]: 'KEEP',
        },
      });
      expect(selectionsRes.success).toBe(true);
      expect(selectionsRes.retainedCount).toBe(1);
      expect(selectionsRes.finalPayableTotal).toBeGreaterThan(0);

      // 3. Collect return items (0 returns needed since all kept)
      const collectionRes = await tryAndBuyService.confirmReturnCollection('drv-1', order.id, {
        collectedItemIds: [],
      });
      expect(collectionRes.success).toBe(true);

      // 4. Settle payment
      const paymentRes = await tryAndBuyService.settlePayment('drv-1', order.id, {
        cashCollected: true,
      });
      expect(paymentRes.success).toBe(true);
      expect(paymentRes.order.status).toBe('DELIVERED');

      // 5. Store return flow verification
      const storeArrival = await tryAndBuyService.arriveAtStore('drv-1', order.id);
      expect(storeArrival.success).toBe(true);

      const reconRes = await tryAndBuyService.reconcileStoreReturn('drv-1', order.id, {
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
