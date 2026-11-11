import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ReviewsService } from './modules/reviews/reviews.service';
import { SupportService } from './modules/support/support.service';
import { SupabaseStorageService } from './modules/media/supabase-storage.service';
import { CartService } from './modules/cart/cart.service';
import { TrackingRealtimeGateway } from './modules/orders/tracking-realtime.gateway';
import { NotificationsService } from './modules/notifications/notifications.service';
import { DeviceTokensService } from './modules/notifications/device-tokens.service';
import { createJwtToken } from './common/utils/crypto.util';
import { createCheckoutSessionToken } from './common/utils/checkout-session.util';
import { Role } from './common/enums/role.enum';

describe('DCR-012..DCR-015 & PostgreSQL Consolidation Compliance', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let paymentsService: PaymentsService;
  let reviewsService: ReviewsService;
  let supportService: SupportService;
  let storageService: SupabaseStorageService;
  let cartService: CartService;
  let trackingGateway: TrackingRealtimeGateway;
  let notificationsService: NotificationsService;
  let deviceTokensService: DeviceTokensService;

  const runId = `dcr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  let prevRzpKey: string | undefined;
  let prevRzpSecret: string | undefined;
  let prevRolePermissionsSetting: any = null;
  let hadRolePermissionsSetting = false;

  const createdUserIds: string[] = [];
  const createdVendorIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdHubIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdCouponIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdGroupIds: string[] = [];
  const createdReviewIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdNotificationIds: string[] = [];
  const createdDeviceTokens: string[] = [];

  let adminToken: string;

  beforeAll(async () => {
    prevRzpKey = process.env.RAZORPAY_KEY_ID;
    prevRzpSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_dcr_spec';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_dcr_spec';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);
    paymentsService = moduleRef.get(PaymentsService);
    reviewsService = moduleRef.get(ReviewsService);
    supportService = moduleRef.get(SupportService);
    storageService = moduleRef.get(SupabaseStorageService);
    cartService = moduleRef.get(CartService);
    trackingGateway = moduleRef.get(TrackingRealtimeGateway);
    notificationsService = moduleRef.get(NotificationsService);
    deviceTokensService = moduleRef.get(DeviceTokensService);

    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) {
      throw new Error('Expected at least one seeded ADMIN user in PostgreSQL');
    }
    adminToken = createJwtToken({
      sub: adminUser.id,
      firebaseUid: adminUser.firebaseUid,
      email: adminUser.email,
      name: adminUser.name,
      role: Role.ADMIN,
    });

    const existingPermSetting = await prisma.workspaceSetting.findUnique({
      where: { key: 'rolePermissions' },
    });
    if (existingPermSetting) {
      hadRolePermissionsSetting = true;
      prevRolePermissionsSetting = existingPermSetting.value;
    }
  });

  afterAll(async () => {
    if (prevRzpKey === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevRzpKey;

    if (prevRzpSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevRzpSecret;

    if (hadRolePermissionsSetting) {
      await prisma.workspaceSetting.upsert({
        where: { key: 'rolePermissions' },
        update: { value: prevRolePermissionsSetting },
        create: { key: 'rolePermissions', value: prevRolePermissionsSetting },
      });
    } else {
      await prisma.workspaceSetting
        .delete({ where: { key: 'rolePermissions' } })
        .catch(() => {});
    }

    if (createdReviewIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdReviewIds } } });
      await prisma.review.deleteMany({ where: { id: { in: createdReviewIds } } });
    }

    if (createdTicketIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdTicketIds } } });
      await prisma.supportTicket.deleteMany({ where: { id: { in: createdTicketIds } } });
    }

    if (createdOrderIds.length > 0) {
      await prisma.review.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.supportTicket.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdOrderIds } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdOrderIds } } });
      await prisma.paymentTransaction.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.tryAndBuySession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }

    if (createdGroupIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
      });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdGroupIds } } });
      await prisma.checkoutGroup.deleteMany({ where: { id: { in: createdGroupIds } } });
    }

    if (createdCouponIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdCouponIds } } });
      await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
    }

    if (createdProductIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProductIds } } });
      await prisma.cartItem.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.review.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }

    if (createdHubIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdHubIds } } });
      await prisma.darkStoreHub.deleteMany({ where: { id: { in: createdHubIds } } });
    }

    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
    }

    if (createdDeviceTokens.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: createdDeviceTokens } } });
    }

    if (createdAddressIds.length > 0) {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } });
    }

    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUserIds } } });
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.deviceToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
      await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
    }

    await prisma.auditLog.deleteMany({
      where: {
        entityId: 'role_dcr_test',
      },
    });

    if (createdDriverProfileIds.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { id: { in: createdDriverProfileIds } } });
    }

    if (createdVendorIds.length > 0) {
      await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await app?.close();
    await moduleRef?.close();
  });

  function signUserToken(u: {
    id: string;
    firebaseUid?: string | null;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    role: Role;
    driverId?: string;
    vendorId?: string;
  }) {
    return createJwtToken({
      sub: u.id,
      firebaseUid: u.firebaseUid ?? undefined,
      email: u.email ?? undefined,
      phone: u.phone ?? undefined,
      name: u.name ?? undefined,
      role: u.role,
      driverId: u.driverId,
      vendorId: u.vendorId,
    });
  }

  describe('1. Hosted Razorpay Checkout Session & Status Contracts (DCR-013 / D-020)', () => {
    it('serves hosted checkout HTML via valid HMAC ?st= without Authorization header and rejects tampered/missing tokens', async () => {
      const custId = `${runId}_pay_u`;
      const addrId = `${runId}_pay_a`;
      const groupId = `${runId}_pay_g`;
      const orderId = `${runId}_pay_o`;
      createdUserIds.push(custId);
      createdAddressIds.push(addrId);
      createdGroupIds.push(groupId);
      createdOrderIds.push(orderId);

      await prisma.user.create({
        data: {
          id: custId,
          firebaseUid: `fb_${custId}`,
          name: 'Pay Test Customer',
          email: `${custId}@affordz.in`,
          phone: `+919911${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });
      await prisma.address.create({
        data: {
          id: addrId,
          userId: custId,
          label: 'Home',
          recipientName: 'Pay Test Customer',
          recipientPhone: '+919911000111',
          line1: '100 Feet Road',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
          latitude: 12.9784,
          longitude: 77.6408,
        },
      });
      await prisma.checkoutGroup.create({
        data: {
          id: groupId,
          groupNumber: `CG-${runId.slice(-4)}-PAY`.toUpperCase(),
          customerId: custId,
          addressId: addrId,
          itemTotal: 1500,
          grandTotal: 1575,
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PENDING',
        },
      });
      await prisma.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-PAY-${Date.now().toString().slice(-4)}`,
          checkoutGroupId: groupId,
          customerId: custId,
          vendorId: 'vend-1',
          addressId: addrId,
          fulfillmentType: 'DARK_STORE',
          status: 'PLACED',
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PENDING',
          razorpayPaymentId: `pay_test_${runId}`,
          itemTotal: 1500,
          taxes: 75,
          grandTotal: 1575,
        },
      });

      const created = await paymentsService.createRazorpayOrder(1575, groupId, custId, Role.CUSTOMER);
      expect(created.amountInPaisa).toBe(157500);
      expect(created.amount).toBe(157500);

      const st = createCheckoutSessionToken(groupId, custId);

      // Missing st and missing Authorization must fail closed
      await request(app.getHttpServer())
        .get(`/api/v1/payments/razorpay/checkout-session/${groupId}`)
        .expect(401);

      // Tampered st must fail closed
      await request(app.getHttpServer())
        .get(`/api/v1/payments/razorpay/checkout-session/${groupId}?st=${st}tampered`)
        .expect(401);

      // Valid st without Authorization header renders Affordz hosted callback HTML
      const htmlRes = await request(app.getHttpServer())
        .get(`/api/v1/payments/razorpay/checkout-session/${groupId}?st=${encodeURIComponent(st)}`)
        .expect(200);
      expect(htmlRes.headers['content-type']).toContain('text/html');
      expect(htmlRes.text).toContain('affordz://payment-callback');
      expect(htmlRes.text).toContain('rzp_test_dcr_spec');

      const status = await paymentsService.getPaymentStatus(orderId, custId, Role.CUSTOMER);
      expect(status.orderNumber).toContain('KC-PAY-');
      expect(status.orderStatus).toBe('PLACED');
      expect(status.razorpayPaymentId).toBe(`pay_test_${runId}`);
      expect(status.updatedAt).toBeTruthy();
    });
  });

  describe('2. Users Profile Nullability, Empty Phone Collision Guard & Self-Deletion', () => {
    it('handles null/empty email & empty phone cleanly and deactivates/anonymizes on DELETE /api/v1/users/me', async () => {
      const u1 = `${runId}_usr1`;
      const u2 = `${runId}_usr2`;
      createdUserIds.push(u1, u2);

      await prisma.user.createMany({
        data: [
          {
            id: u1,
            firebaseUid: `fb_${u1}`,
            name: 'User One',
            email: `${u1}@affordz.in`,
            phone: `+919922${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          {
            id: u2,
            firebaseUid: `fb_${u2}`,
            name: 'User Two',
            email: `${u2}@affordz.in`,
            phone: `+919923${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
        ],
      });

      const tok1 = signUserToken({ id: u1, firebaseUid: `fb_${u1}`, role: Role.CUSTOMER });
      const tok2 = signUserToken({ id: u2, firebaseUid: `fb_${u2}`, role: Role.CUSTOMER });

      const r1 = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tok1}`)
        .send({ email: null, phone: '' })
        .expect(200);
      expect(r1.body.email).toBeNull();
      expect(r1.body.phone).toBeNull();

      // Second user setting email: '' and phone: '' must not throw TypeError or P2002 collision
      const r2 = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tok2}`)
        .send({ email: '', phone: '' })
        .expect(200);
      expect(r2.body.email).toBeNull();
      expect(r2.body.phone).toBeNull();

      const delRes = await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${tok1}`)
        .expect(200);
      expect(delRes.body.success).toBe(true);

      const deletedDb = await prisma.user.findUnique({ where: { id: u1 } });
      expect(deletedDb?.status).toBe('DELETED');
      expect(deletedDb?.email).toBeNull();
      expect(deletedDb?.phone).toBeNull();
      expect(deletedDb?.firebaseUid).toMatch(/^deleted:/);

      // Deleted user cannot reuse old token (guard blocks non-ACTIVE account)
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tok1}`)
        .expect(403);
    });
  });

  describe('3. Reviews Ownership (DCR-014), Support Postgres (DCR-015) & Media PDF (O-003)', () => {
    it('enforces order ownership + DELIVERED status on ReviewsService and persists SupportTicket priority/description', async () => {
      const custId = `${runId}_rev_c`;
      const otherCustId = `${runId}_rev_o`;
      const addrId = `${runId}_rev_a`;
      const prodId = `${runId}_rev_p`;
      const placedOrderId = `${runId}_rev_ord_placed`;
      const delivOrderId = `${runId}_rev_ord_deliv`;
      createdUserIds.push(custId, otherCustId);
      createdAddressIds.push(addrId);
      createdProductIds.push(prodId);
      createdOrderIds.push(placedOrderId, delivOrderId);

      await prisma.user.createMany({
        data: [
          {
            id: custId,
            firebaseUid: `fb_${custId}`,
            name: 'Review Owner',
            email: `${custId}@affordz.in`,
            phone: `+919931${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          {
            id: otherCustId,
            firebaseUid: `fb_${otherCustId}`,
            name: 'Other Customer',
            email: `${otherCustId}@affordz.in`,
            phone: `+919932${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
        ],
      });
      await prisma.address.create({
        data: {
          id: addrId,
          userId: custId,
          label: 'Home',
          recipientName: 'Review Owner',
          recipientPhone: '+919931000111',
          line1: 'MG Road',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
          latitude: 12.9784,
          longitude: 77.6408,
        },
      });
      await prisma.product.create({
        data: {
          id: prodId,
          title: `DCR Review Kurta ${runId}`,
          brand: 'Affordz Official Store',
          description: 'Kurta',
          vendorId: 'vend-1',
          categoryId: 'kurtis',
          price: 1200,
          originalPrice: 1500,
          discount: '20% OFF',
          sizes: ['M'],
          image: 'https://example.com/rev.jpg',
          altText: 'Kurta',
          galleryImages: [],
          stockQuantity: 10,
          fulfillmentType: 'VENDOR',
        },
      });
      await prisma.order.create({
        data: {
          id: placedOrderId,
          orderNumber: `KC-RP-${Date.now().toString().slice(-4)}`,
          customerId: custId,
          vendorId: 'vend-1',
          addressId: addrId,
          fulfillmentType: 'VENDOR',
          status: 'PLACED',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          itemTotal: 1200,
          taxes: 60,
          grandTotal: 1260,
          items: {
            create: {
              productId: prodId,
              title: 'DCR Review Kurta',
              brand: 'Affordz',
              size: 'M',
              price: 1200,
              quantity: 1,
              image: 'https://example.com/rev.jpg',
            },
          },
        },
      });
      await prisma.order.create({
        data: {
          id: delivOrderId,
          orderNumber: `KC-RD-${Date.now().toString().slice(-4)}`,
          customerId: custId,
          vendorId: 'vend-1',
          addressId: addrId,
          fulfillmentType: 'VENDOR',
          status: 'DELIVERED',
          paymentMethod: 'COD',
          paymentStatus: 'COMPLETED',
          deliveredAt: new Date(),
          itemTotal: 1200,
          taxes: 60,
          grandTotal: 1260,
          items: {
            create: {
              productId: prodId,
              title: 'DCR Review Kurta',
              brand: 'Affordz',
              size: 'M',
              price: 1200,
              quantity: 1,
              image: 'https://example.com/rev.jpg',
            },
          },
        },
      });

      // Non-owner blocked
      await expect(
        reviewsService.createReview(otherCustId, {
          productId: prodId,
          orderId: delivOrderId,
          rating: 5,
          comment: 'Trying to review another user order',
        }),
      ).rejects.toThrow(ForbiddenException);

      // Undelivered order blocked
      await expect(
        reviewsService.createReview(custId, {
          productId: prodId,
          orderId: placedOrderId,
          rating: 5,
          comment: 'Order not yet delivered',
        }),
      ).rejects.toThrow(BadRequestException);

      // Valid delivered order succeeds
      const createdReview = await reviewsService.createReview(custId, {
        productId: prodId,
        orderId: delivOrderId,
        rating: 5,
        comment: 'Great fabric and timely delivery!',
      });
      expect(createdReview.success).toBe(true);
      createdReviewIds.push(createdReview.review.id);

      // Duplicate blocked
      await expect(
        reviewsService.createReview(custId, {
          productId: prodId,
          orderId: delivOrderId,
          rating: 4,
          comment: 'Duplicate attempt',
        }),
      ).rejects.toThrow(ConflictException);

      // Support ticket in PostgreSQL
      const ticket = await supportService.createTicket(custId, {
        orderId: delivOrderId,
        category: 'Delivery & Rider Help',
        priority: 'URGENT',
        title: 'Packaging wet upon handover',
        description: 'Outer pouch had minor water mark near seal.',
      });
      createdTicketIds.push(ticket.id);
      expect(ticket.category).toBe('DELIVERY');
      expect(ticket.priority).toBe('URGENT');
      expect(ticket.description).toBe('Outer pouch had minor water mark near seal.');

      const dbTicket = await prisma.supportTicket.findUnique({ where: { id: ticket.id } });
      expect(dbTicket?.status).toBe('OPEN');
      expect(dbTicket?.orderId).toBe(delivOrderId);
    });

    it('allows application/pdf in SupabaseStorageService, rejects invalid MIME, and never uses hardcoded fallback credentials', async () => {
      expect(storageService).toBeDefined();

      const prevUrl = process.env.SUPABASE_URL;
      const prevNextUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const prevKey = process.env.SUPABASE_KEY;
      const prevPubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const pdfBuf = Buffer.from('%PDF-1.4');
      const txtBuf = Buffer.from('plain text');

      try {
        delete process.env.SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.SUPABASE_KEY;
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        const unconfiguredStorage = new SupabaseStorageService();
        await expect(
          unconfiguredStorage.uploadProductImage({
            buffer: pdfBuf,
            mimetype: 'application/pdf',
            originalname: 'kyc.pdf',
            size: pdfBuf.length,
          }),
        ).rejects.toThrow('Supabase Storage is not configured');

        process.env.SUPABASE_URL = 'https://dcr-test.supabase.co';
        process.env.SUPABASE_KEY = 'sb_test_service_key';
        const configuredStorage = new SupabaseStorageService();

        await expect(
          configuredStorage.uploadProductImage({
            buffer: txtBuf,
            mimetype: 'text/plain',
            originalname: 'notes.txt',
            size: txtBuf.length,
          }),
        ).rejects.toThrow('Invalid file type');

        const fetchSpy = jest
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce(new Response(JSON.stringify({ Key: 'ok' }), { status: 200 }));
        try {
          const uploaded = await configuredStorage.uploadProductImage({
            buffer: pdfBuf,
            mimetype: 'application/pdf',
            originalname: 'driver-rc.pdf',
            size: pdfBuf.length,
          });
          expect(uploaded.url).toContain('.pdf');
          expect(fetchSpy).toHaveBeenCalledTimes(1);
        } finally {
          fetchSpy.mockRestore();
        }
      } finally {
        if (prevUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = prevUrl;
        if (prevNextUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = prevNextUrl;
        if (prevKey === undefined) delete process.env.SUPABASE_KEY;
        else process.env.SUPABASE_KEY = prevKey;
        if (prevPubKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevPubKey;
        if (prevServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
      }
    });
  });

  describe('4. Orders Checkout Validation, Tracking (DCR-005), WebSocket Seq & FCM Deactivation', () => {
    it('blocks Dark Store checkout without lat/lng, isolates Try & Buy to DARK_STORE bucket, gates trackOrder fields, and emits monotonic WS seq', async () => {
      const custId = `${runId}_ord_c`;
      const drvUserId = `${runId}_ord_du`;
      const drvProfId = `${runId}_ord_dp`;
      const noCoordAddrId = `${runId}_addr_nocoord`;
      const coordAddrId = `${runId}_addr_coord`;
      const hubId = `${runId}_hub`;
      const darkProdId = `${runId}_prod_dark`;
      const vendProdId = `${runId}_prod_vend`;

      createdUserIds.push(custId, drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdAddressIds.push(noCoordAddrId, coordAddrId);
      createdHubIds.push(hubId);
      createdProductIds.push(darkProdId, vendProdId);

      const drvPhone = `+919941${Math.floor(100000 + Math.random() * 899999)}`;
      await prisma.user.createMany({
        data: [
          {
            id: custId,
            firebaseUid: `fb_${custId}`,
            name: 'Order Test Customer',
            email: `${custId}@affordz.in`,
            phone: `+919940${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          {
            id: drvUserId,
            firebaseUid: `fb_${drvUserId}`,
            name: 'Order Track Driver',
            email: `${drvUserId}@affordz.in`,
            phone: drvPhone,
            role: 'DRIVER',
            status: 'ACTIVE',
          },
        ],
      });
      await prisma.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: 'Order Track Driver',
          phone: drvPhone,
          kycStatus: 'APPROVED',
          isOnline: true,
          rating: 4.9,
          vehicleType: 'Scooter',
          vehicleRegistration: 'KA01DCR1234',
        },
      });
      await prisma.darkStoreHub.create({
        data: {
          id: hubId,
          name: `DCR Test Hub ${runId}`,
          locality: 'Indiranagar',
          address: '100 Feet Rd',
          lat: 12.9784,
          lng: 77.6408,
          deliveryMinutes: 25,
          isActive: true,
        },
      });
      await prisma.address.createMany({
        data: [
          {
            id: noCoordAddrId,
            userId: custId,
            label: 'Home',
            recipientName: 'Order Test Customer',
            recipientPhone: '+919940000111',
            line1: 'No GPS Lane',
            locality: 'Indiranagar',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560038',
            latitude: null,
            longitude: null,
          },
          {
            id: coordAddrId,
            userId: custId,
            label: 'Work',
            recipientName: 'Order Test Customer',
            recipientPhone: '+919940000111',
            line1: '12th Main Indiranagar',
            locality: 'Indiranagar',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560038',
            latitude: 12.9716,
            longitude: 77.5946,
          },
        ],
      });
      await prisma.product.createMany({
        data: [
          {
            id: darkProdId,
            title: `DCR Dark Kurta ${runId}`,
            brand: 'Affordz Official Store',
            description: 'Dark Store Try & Buy item',
            vendorId: 'vend-affordz-official',
            categoryId: 'kurtis',
            price: 1000,
            originalPrice: 1200,
            discount: '17% OFF',
            sizes: ['M', 'L'],
            image: 'https://example.com/d.jpg',
            altText: 'Dark Kurta',
            galleryImages: [],
            stockQuantity: 10,
            fulfillmentType: 'DARK_STORE',
            darkStoreHubId: hubId,
            tryAndBuyEligible: true,
            listingStatus: 'ACTIVE',
          },
          {
            id: vendProdId,
            title: `DCR Vendor Saree ${runId}`,
            brand: 'Avanya Ethnic Boutique',
            description: 'Vendor fulfilled item',
            vendorId: 'vend-1',
            categoryId: 'kurtis',
            price: 1500,
            originalPrice: 1800,
            discount: '17% OFF',
            sizes: ['M'],
            image: 'https://example.com/v.jpg',
            altText: 'Vendor Saree',
            galleryImages: [],
            stockQuantity: 10,
            fulfillmentType: 'VENDOR',
            tryAndBuyEligible: false,
            listingStatus: 'ACTIVE',
          },
        ],
      });

      const custToken = signUserToken({ id: custId, firebaseUid: `fb_${custId}`, role: Role.CUSTOMER });

      // Missing lat/lng blocked for DARK_STORE buyNow
      const missingCoordsRes = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${custToken}`)
        .send({
          addressId: noCoordAddrId,
          paymentMethod: 'RAZORPAY',
          isBuyNow: true,
          buyNowItem: { productId: darkProdId, size: 'M', quantity: 1 },
        })
        .expect(400);
      expect(String(missingCoordsRes.body.message)).toContain('latitude and longitude');

      // Mixed cart with isTryAndBuy=true isolates Try & Buy to DARK_STORE bucket only
      await cartService.addItem(custId, darkProdId, 'M', 1, 'L');
      await cartService.addItem(custId, vendProdId, 'M', 1);

      const checkoutRes = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${custToken}`)
        .send({
          addressId: coordAddrId,
          paymentMethod: 'RAZORPAY',
          isTryAndBuy: true,
          deliveryInstructions: 'Call upon arrival at Gate 2',
        })
        .expect(201);

      createdGroupIds.push(checkoutRes.body.checkoutGroupId);
      for (const ord of checkoutRes.body.orders) {
        createdOrderIds.push(ord.id);
      }

      expect(checkoutRes.body.razorpayKeyId).toBe('rzp_test_dcr_spec');
      expect(checkoutRes.body.checkoutSessionToken).toBeTruthy();
      expect(checkoutRes.body.checkoutSessionUrl).toContain(
        `/api/v1/payments/razorpay/checkout-session/${checkoutRes.body.checkoutGroupId}?st=`,
      );
      expect(checkoutRes.body.orders).toHaveLength(2);

      const darkOrder = checkoutRes.body.orders.find((o: any) => o.fulfillmentType === 'DARK_STORE');
      const vendOrder = checkoutRes.body.orders.find((o: any) => o.fulfillmentType === 'VENDOR');
      expect(darkOrder?.isTryAndBuy).toBe(true);
      expect(vendOrder?.isTryAndBuy).toBe(false);
      expect(darkOrder?.deliveryInstructions).toBe('Call upon arrival at Gate 2');

      // PLACED tracking hides driver object
      const preTrackRes = await request(app.getHttpServer())
        .get(`/api/v1/orders/${darkOrder.id}/track`)
        .set('Authorization', `Bearer ${custToken}`)
        .expect(200);
      expect(preTrackRes.body.driver).toBeNull();
      expect(preTrackRes.body.handoverOtp).toBeTruthy();

      // OUT_FOR_DELIVERY exposes driver with rating & arrived state
      await prisma.order.update({
        where: { id: darkOrder.id },
        data: {
          driverId: drvUserId,
          driverProfileId: drvProfId,
          status: 'OUT_FOR_DELIVERY',
          arrivedAt: new Date(),
        },
      });
      const liveTrackRes = await request(app.getHttpServer())
        .get(`/api/v1/orders/${darkOrder.id}/track`)
        .set('Authorization', `Bearer ${custToken}`)
        .expect(200);
      expect(liveTrackRes.body.isArrived).toBe(true);
      expect(liveTrackRes.body.driver?.id).toBe(drvProfId);
      expect(liveTrackRes.body.driver?.rating).toBe(4.9);

      // TrackingRealtimeGateway monotonic seq & TRY_AND_BUY_UPDATED compatibility
      const sentPayloads: any[] = [];
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: (data: string) => sentPayloads.push(JSON.parse(data)),
        close: jest.fn(),
        terminate: jest.fn(),
      } as unknown as WebSocket;

      const roomsMap = (trackingGateway as any).rooms as Map<string, Set<any>>;
      roomsMap.set(darkOrder.id, new Set([{ ws: mockWs, orderId: darkOrder.id, isAlive: true }]));
      try {
        trackingGateway.broadcastStatusUpdate(darkOrder.id, 'OUT_FOR_DELIVERY', {
          eventType: 'TRY_AND_BUY_UPDATED',
          items: [],
        });
        trackingGateway.broadcastStatusUpdate(darkOrder.id, 'OUT_FOR_DELIVERY', {
          event: 'TRY_AND_BUY_UPDATED',
          stage: 'SELECTION_CONFIRMED',
        });

        expect(sentPayloads).toHaveLength(2);
        expect(sentPayloads[0].type).toBe('TRY_AND_BUY_UPDATED');
        expect(sentPayloads[0].seq).toBe(1);
        expect(sentPayloads[1].type).toBe('TRY_AND_BUY_UPDATED');
        expect(sentPayloads[1].seq).toBe(2);
      } finally {
        roomsMap.delete(darkOrder.id);
        (trackingGateway as any).orderSeqMap?.delete?.(darkOrder.id);
      }

      // NotificationsService wires deviceTokensService.deactivateInvalidTokens
      const staleFcmToken = `fcm-stale-${runId}`;
      createdDeviceTokens.push(staleFcmToken);
      await deviceTokensService.registerToken(custId, Role.CUSTOMER, 'android', staleFcmToken);

      const multicastSpy = jest
        .spyOn((notificationsService as any).firebaseAdmin, 'sendMulticastPush')
        .mockResolvedValueOnce({
          successCount: 0,
          failureCount: 1,
          invalidTokens: [staleFcmToken],
        });
      try {
        const pushRes = await notificationsService.sendNotification({
          recipientUserId: custId,
          recipientRole: Role.CUSTOMER,
          title: 'DCR Push Verification',
          body: 'Testing invalid token cleanup',
        });
        if (pushRes.notificationId) createdNotificationIds.push(pushRes.notificationId);
      } finally {
        multicastSpy.mockRestore();
      }

      const tokenRow = await prisma.deviceToken.findUnique({ where: { token: staleFcmToken } });
      expect(tokenRow?.isActive).toBe(false);
    });
  });

  describe('5. Vendor Firebase Auth, Driver RBAC Guards & Admin CRUD / Aliases', () => {
    it('authenticates Vendor via Firebase -> PostgreSQL, enforces Driver guards, and exercises Admin Coupons, Hubs, Reports, Permissions, Support & Catalog', async () => {
      const custUserId = `${runId}_rbac_c`;
      const vendUserId = `${runId}_vend_u`;
      const vendorId = `${runId}_vend`;
      const prodId = `${runId}_adm_p`;
      const tktId = `${runId}_adm_tkt`;
      createdUserIds.push(custUserId, vendUserId);
      createdVendorIds.push(vendorId);
      createdProductIds.push(prodId);
      createdTicketIds.push(tktId);

      const vendPhone = `+919951${Math.floor(100000 + Math.random() * 899999)}`;
      await prisma.user.createMany({
        data: [
          {
            id: custUserId,
            firebaseUid: `fb_${custUserId}`,
            name: 'RBAC Customer',
            email: `${custUserId}@affordz.in`,
            phone: `+919950${Math.floor(100000 + Math.random() * 899999)}`,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          {
            id: vendUserId,
            firebaseUid: `fb_${vendUserId}`,
            name: 'DCR Boutique Owner',
            email: `${vendUserId}@affordz.in`,
            phone: vendPhone,
            role: 'VENDOR',
            status: 'ACTIVE',
          },
        ],
      });
      await prisma.vendor.create({
        data: {
          id: vendorId,
          userId: vendUserId,
          storeName: `DCR Store ${runId}`,
          contactPerson: 'DCR Boutique Owner',
          phone: vendPhone,
          address: 'Bengaluru',
          status: 'ACTIVE',
          commissionRate: 15,
        },
      });
      await prisma.product.create({
        data: {
          id: prodId,
          title: `DCR Admin Prod ${runId}`,
          brand: 'Affordz Official Store',
          description: 'Admin test product',
          vendorId,
          categoryId: 'kurtis',
          price: 900,
          originalPrice: 1200,
          discount: '25% OFF',
          sizes: ['M'],
          image: 'https://example.com/adm.jpg',
          altText: 'Admin Prod',
          galleryImages: [],
          stockQuantity: 5,
          fulfillmentType: 'VENDOR',
          listingStatus: 'ACTIVE',
        },
      });
      await prisma.supportTicket.create({
        data: {
          id: tktId,
          userId: custUserId,
          title: `Admin close test ${runId}`,
          description: 'Need close remark check',
          category: 'GENERAL',
          priority: 'NORMAL',
          status: 'OPEN',
        },
      });

      // Driver route requires auth & DRIVER role
      await request(app.getHttpServer()).get('/api/v1/driver/earnings').expect(401);
      const custToken = signUserToken({ id: custUserId, firebaseUid: `fb_${custUserId}`, role: Role.CUSTOMER });
      await request(app.getHttpServer())
        .get('/api/v1/driver/earnings')
        .set('Authorization', `Bearer ${custToken}`)
        .expect(403);

      // Vendor Firebase login + /me + /logout
      const vendFirebaseToken = `test-firebase-id-token:fb_${vendUserId}:${vendPhone}:${vendUserId}@affordz.in`;
      const vLogin = await request(app.getHttpServer())
        .post('/api/v1/vendor/auth/firebase/login')
        .send({ idToken: vendFirebaseToken })
        .expect(200);
      expect(vLogin.body.token).toBeTruthy();
      expect(vLogin.body.role).toBe(Role.VENDOR);

      const vMe = await request(app.getHttpServer())
        .get('/api/v1/vendor/auth/me')
        .set('Authorization', `Bearer ${vLogin.body.token}`)
        .expect(200);
      expect(vMe.body.vendor?.id).toBe(vendorId);

      const vPatch = await request(app.getHttpServer())
        .patch('/api/v1/vendor/auth/me')
        .set('Authorization', `Bearer ${vLogin.body.token}`)
        .send({ storeName: `DCR Store Updated ${runId}` })
        .expect(200);
      expect(vPatch.body.vendor?.storeName).toBe(`DCR Store Updated ${runId}`);

      await request(app.getHttpServer())
        .post('/api/v1/vendor/auth/logout')
        .set('Authorization', `Bearer ${vLogin.body.token}`)
        .expect(200);

      // Admin Coupons CRUD
      const couponCode = `DCR${runId.slice(-5).toUpperCase()}`;
      const couponCreate = await request(app.getHttpServer())
        .post('/api/v1/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: couponCode,
          discountType: 'PERCENTAGE',
          discountValue: 15,
          minOrderValue: 500,
          endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        })
        .expect(201);
      const createdCouponId = couponCreate.body.coupon.id;
      createdCouponIds.push(createdCouponId);

      await request(app.getHttpServer())
        .get('/api/v1/admin/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const couponPatch = await request(app.getHttpServer())
        .patch(`/api/v1/admin/coupons/${createdCouponId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ discountValue: 20 })
        .expect(200);
      expect(couponPatch.body.coupon.discountValue).toBe(20);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/coupons/${createdCouponId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Admin Hubs CRUD
      const hubCreate = await request(app.getHttpServer())
        .post('/api/v1/admin/hubs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `CRUD Hub ${runId}`,
          locality: 'Koramangala',
          address: '80 Feet Rd',
          lat: 12.9352,
          lng: 77.6245,
          deliveryMinutes: 20,
        })
        .expect(201);
      const createdHubId = hubCreate.body.data.id;
      createdHubIds.push(createdHubId);

      await request(app.getHttpServer())
        .get('/api/v1/admin/hubs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const hubPatch = await request(app.getHttpServer())
        .patch(`/api/v1/admin/hubs/${createdHubId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deliveryMinutes: 18 })
        .expect(200);
      expect(hubPatch.body.data.deliveryMinutes).toBe(18);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/hubs/${createdHubId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Admin Reports base route & Permissions alias
      const repRes = await request(app.getHttpServer())
        .get('/api/v1/admin/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(repRes.body.category).toBe('ORDERS');

      await request(app.getHttpServer())
        .get('/api/v1/admin/user-access/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const permPatch = await request(app.getHttpServer())
        .patch('/api/v1/admin/user-access/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          roleId: 'role_dcr_test',
          permissions: { Orders: ['READ'] },
        })
        .expect(200);
      expect(permPatch.body.success).toBe(true);

      // Admin Support CLOSED + resolutionNote alias & Catalog status/stock aliases
      const tktPatch = await request(app.getHttpServer())
        .patch(`/api/v1/admin/support/tickets/${tktId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CLOSED', resolutionNote: 'Closed via DCR test' })
        .expect(200);
      expect(tktPatch.body.ticket?.status).toBe('CLOSED');

      const prodStatus = await request(app.getHttpServer())
        .patch(`/api/v1/admin/products/${prodId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DRAFT' })
        .expect(200);
      expect(prodStatus.body.product?.listingStatus).toBe('DRAFT');

      const prodStock = await request(app.getHttpServer())
        .patch(`/api/v1/admin/products/${prodId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stock: 18 })
        .expect(200);
      expect(prodStock.body.product?.stockQuantity).toBe(18);
    });
  });
});
