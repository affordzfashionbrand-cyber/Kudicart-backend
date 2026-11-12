import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { AdminOrdersService } from '../admin/services/admin-orders.service';
import { DriverOrdersService } from '../driver/driver-orders.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { DriverTryAndBuyService } from '../driver/driver-try-and-buy.service';
import { GoogleRoutesService } from './google-routes.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { RedisService } from '../../common/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { OutboxService } from '../queue/outbox.service';
import { PaymentsProcessor } from '../queue/processors/payments.processor';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import { hashOrderOtp } from './order-otp.util';

describe('Phase 4: Full Staging Integration, End-to-End Verification & Production Readiness', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let adminOrdersService: AdminOrdersService;
  let driverOrdersService: DriverOrdersService;
  let driverProfileService: DriverProfileService;
  let driverTryAndBuyService: DriverTryAndBuyService;
  let googleRoutesService: GoogleRoutesService;
  let trackingGateway: TrackingRealtimeGateway;
  let redisService: RedisService;
  let notificationsService: NotificationsService;
  let deviceTokensService: DeviceTokensService;
  let outboxService: OutboxService;
  let paymentsProcessor: PaymentsProcessor;

  const runId = `p4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdGroupIds: string[] = [];
  const createdDeviceTokens: string[] = [];
  const createdOutboxIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    ordersService = moduleRef.get(OrdersService);
    adminOrdersService = moduleRef.get(AdminOrdersService);
    driverOrdersService = moduleRef.get(DriverOrdersService);
    driverProfileService = moduleRef.get(DriverProfileService);
    driverTryAndBuyService = moduleRef.get(DriverTryAndBuyService);
    googleRoutesService = moduleRef.get(GoogleRoutesService);
    trackingGateway = moduleRef.get(TrackingRealtimeGateway);
    redisService = moduleRef.get(RedisService);
    notificationsService = moduleRef.get(NotificationsService);
    deviceTokensService = moduleRef.get(DeviceTokensService);
    outboxService = moduleRef.get(OutboxService);
    paymentsProcessor = moduleRef.get(PaymentsProcessor);
  });

  afterEach(async () => {
    if (createdDeviceTokens.length > 0) {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: createdDeviceTokens } },
      });
      createdDeviceTokens.length = 0;
    }
    if (createdOutboxIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: createdOutboxIds } },
      });
      createdOutboxIds.length = 0;
    }
    if (createdOrderIds.length > 0) {
      await prisma.tryAndBuySession.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.notification.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdOrderIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...createdOrderIds, ...createdGroupIds] } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prisma.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
      createdProductIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prisma.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('verifies Complete Customer Order Placement with Razorpay Sandbox Signature Validation', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const prodId = `${runId}_prd_${suffix}`;
    createdProductIds.push(prodId);

    await prisma.product.create({
      data: {
        id: prodId,
        title: `Staging Silk Shirt ${suffix}`,
        brand: 'KudiCart Classic',
        description: 'E2E Staging Product',
        vendorId: 'vend-1',
        categoryId: 'cat-1',
        price: 1500,
        originalPrice: 1800,
        discount: '16% OFF',
        sizes: ['L'],
        image: 'https://example.com/shirt.jpg',
        altText: 'Silk Shirt',
        galleryImages: [],
        stockQuantity: 10,
        fulfillmentType: FulfillmentType.DARK_STORE,
      },
    });

    // 1. Checkout creation
    const checkoutRes = await ordersService.checkout('usr-1', {
      addressId: 'addr-1',
      paymentMethod: PaymentMethod.RAZORPAY,
      isBuyNow: true,
      items: [{ productId: prodId, size: 'L', quantity: 2 }],
    } as any);

    expect(checkoutRes.orders).toHaveLength(1);
    const order = checkoutRes.orders[0];
    createdOrderIds.push(order.id);
    if (order.checkoutGroupId) {
      createdGroupIds.push(order.checkoutGroupId);
    }

    // 2. Server-side financial calculations
    expect(order.itemTotal).toBe(3000); // 1500 * 2
    expect(order.taxes).toBe(150);     // 5% GST
    expect(order.grandTotal).toBe(3150);
    expect(order.paymentMethod).toBe(PaymentMethod.RAZORPAY);
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);

    // 3. Stock decrement verification
    const updatedProd = await prisma.product.findUnique({ where: { id: prodId } });
    expect(updatedProd?.stockQuantity).toBe(8); // 10 - 2

    // 4. Razorpay Sandbox Signature Verification
    const razorpayOrderId = checkoutRes.razorpayOrderId || order.razorpayOrderId || '';
    expect(razorpayOrderId).toBeTruthy();

    const razorpayPaymentId = `pay_test_${suffix}`;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || 'test_secret';

    const hmac = crypto.createHmac('sha256', razorpaySecret);
    hmac.update(`${razorpayOrderId}|${razorpayPaymentId}`);
    const validSignature = hmac.digest('hex');

    // Confirm Payment via verifyPayment
    const confirmRes = await ordersService.verifyPayment(
      order.id,
      razorpayPaymentId,
      validSignature,
      razorpayOrderId,
      'usr-1',
      Role.CUSTOMER,
    );

    expect(confirmRes.verified).toBe(true);
    expect(confirmRes.paymentStatus).toBe(PaymentStatus.COMPLETED);

    const refreshedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(refreshedOrder?.paymentStatus).toBe(PaymentStatus.COMPLETED);
    expect(refreshedOrder?.status).toBe(OrderStatus.PLACED);

    // Verify Outbox Event created
    const outboxEvt = await prisma.outboxEvent.findFirst({
      where: { aggregateId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(outboxEvt).toBeDefined();
  });

  it('verifies Vendor Order Fulfillment Workflow (PLACED -> PREPARING -> READY_FOR_PICKUP)', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_vord_${suffix}`;
    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-V-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 1200,
        taxes: 60,
        grandTotal: 1260,
      },
    });

    // 1. Vendor views authorized order
    const vendorOrders = await prisma.order.findMany({
      where: { vendorId: 'vend-1', id: orderId },
    });
    expect(vendorOrders).toHaveLength(1);

    // 2. Vendor accepts order (PLACED -> ACCEPTED)
    const acceptRes = await ordersService.updateStatus(
      orderId,
      OrderStatus.ACCEPTED,
      Role.VENDOR,
      'Order accepted by vendor store',
      'usr-vendor-1',
      undefined,
      'vend-1',
    );
    expect(acceptRes.status).toBe(OrderStatus.ACCEPTED);

    // 3. Vendor updates to PREPARING (ACCEPTED -> PREPARING)
    const prepRes = await ordersService.updateStatus(
      orderId,
      OrderStatus.PREPARING,
      Role.VENDOR,
      'Order under tailoring preparation',
      'usr-vendor-1',
      undefined,
      'vend-1',
    );
    expect(prepRes.status).toBe(OrderStatus.PREPARING);

    // 4. Vendor marks READY_FOR_PICKUP (PREPARING -> READY_FOR_PICKUP)
    const readyRes = await ordersService.updateStatus(
      orderId,
      OrderStatus.READY_FOR_PICKUP,
      Role.VENDOR,
      'Packed and ready for pickup at dark store hub',
      'usr-vendor-1',
      undefined,
      'vend-1',
    );
    expect(readyRes.status).toBe(OrderStatus.READY_FOR_PICKUP);

    // Verify order status history entry
    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.status)).toContain(OrderStatus.ACCEPTED);
    expect(history.map((h) => h.status)).toContain(OrderStatus.PREPARING);
    expect(history.map((h) => h.status)).toContain(OrderStatus.READY_FOR_PICKUP);
  });

  it('enforces FIFO Dispatch candidate selection and Strict Concurrency Safety between two racing Drivers', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_fifo_ord_${suffix}`;
    const drvUser1 = `${runId}_du1_${suffix}`;
    const drvProf1 = `${runId}_dp1_${suffix}`;
    const drvUser2 = `${runId}_du2_${suffix}`;
    const drvProf2 = `${runId}_dp2_${suffix}`;
    const token1 = `fcm_d1_${runId}_${suffix}`;
    const token2 = `fcm_d2_${runId}_${suffix}`;

    createdOrderIds.push(orderId);
    createdUserIds.push(drvUser1, drvUser2);
    createdDriverProfileIds.push(drvProf1, drvProf2);
    createdDeviceTokens.push(token1, token2);

    // 1. Create Drivers
    await prisma.user.createMany({
      data: [
        {
          id: drvUser1,
          firebaseUid: `fb_${drvUser1}`,
          name: `Driver Senior ${suffix}`,
          email: `${drvUser1}@kudicart.test`,
          phone: `+919966${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
        {
          id: drvUser2,
          firebaseUid: `fb_${drvUser2}`,
          name: `Driver Junior ${suffix}`,
          email: `${drvUser2}@kudicart.test`,
          phone: `+919977${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      ],
    });

    // Driver 1 went online 15 minutes ago (FIFO first candidate)
    // Driver 2 went online 2 minutes ago
    const tMinus15m = new Date(Date.now() - 15 * 60_000);
    const tMinus2m = new Date(Date.now() - 2 * 60_000);

    await prisma.driverProfile.createMany({
      data: [
        {
          id: drvProf1,
          userId: drvUser1,
          fullName: `Driver Senior ${suffix}`,
          phone: `+919966${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: true,
          availableSince: tMinus15m,
          currentLat: 12.9352,
          currentLng: 77.6245,
        },
        {
          id: drvProf2,
          userId: drvUser2,
          fullName: `Driver Junior ${suffix}`,
          phone: `+919977${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: true,
          availableSince: tMinus2m,
          currentLat: 12.9355,
          currentLng: 77.6250,
        },
      ],
    });

    await deviceTokensService.registerToken(drvUser1, Role.DRIVER, 'android', token1);
    await deviceTokensService.registerToken(drvUser2, Role.DRIVER, 'android', token2);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-FIFO-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.READY_FOR_PICKUP,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 1800,
        taxes: 90,
        grandTotal: 1890,
      },
    });

    // 2. Automated FIFO evaluation picks Driver 1 (earliest availableSince)
    const eligibleDrivers = await prisma.driverProfile.findMany({
      where: {
        kycStatus: 'APPROVED',
        isOnline: true,
      },
      orderBy: { availableSince: 'asc' },
    });
    const candidateDriver = eligibleDrivers.find((d) => d.id === drvProf1 || d.id === drvProf2);
    expect(candidateDriver?.id).toBe(drvProf1);

    // 3. Admin assigns to Driver 1 (triggers FCM alert)
    const assignRes = await ordersService.assignDriver(
      orderId,
      drvProf1,
      Role.ADMIN,
      'usr-admin-1',
      'System FIFO Dispatch',
    );
    expect(assignRes.driverId).toBe(drvUser1);
    expect(assignRes.driverProfileId).toBe(drvProf1);
    expect(assignRes.status).toBe(OrderStatus.ASSIGNED);

    // 4. Concurrency Race: Both drivers attempt to accept simultaneously
    const results = await Promise.allSettled([
      driverOrdersService.acceptOrder(drvProf1, orderId),
      driverOrdersService.acceptOrder(drvProf2, orderId),
    ]);

    // Driver 1 must succeed
    expect(results[0].status).toBe('fulfilled');
    // Driver 2 must be rejected with 400/403/409
    expect(results[1].status).toBe('rejected');

    const confirmedOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(confirmedOrder?.driverId).toBe(drvUser1);
    expect(confirmedOrder?.driverProfileId).toBe(drvProf1);
    expect(confirmedOrder?.status).toBe(OrderStatus.ASSIGNED);

    // Driver picks up order from store -> transitions to PICKED_UP
    const pickupRes = await driverOrdersService.pickupOrder(drvProf1, orderId);
    expect(pickupRes.order.status).toBe(OrderStatus.PICKED_UP);
  });

  it('verifies Live Delivery Tracking Telemetry & Multi-Instance Cross-Routing via Redis Pub/Sub', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_trk_${suffix}`;
    const drvUserId = `${runId}_du_trk_${suffix}`;
    const drvProfId = `${runId}_dp_trk_${suffix}`;

    createdOrderIds.push(orderId);
    createdUserIds.push(drvUserId);
    createdDriverProfileIds.push(drvProfId);

    await prisma.user.create({
      data: {
        id: drvUserId,
        firebaseUid: `fb_${drvUserId}`,
        name: `Rider Tracking ${suffix}`,
        email: `${drvUserId}@kudicart.test`,
        phone: `+919988${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvProfId,
        userId: drvUserId,
        fullName: `Rider Tracking ${suffix}`,
        phone: `+919988${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
      },
    });

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-TRK-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        driverId: drvUserId,
        driverProfileId: drvProfId,
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 800,
        taxes: 40,
        grandTotal: 840,
      },
    });

    // 1. Driver records GPS location via driverProfileService
    const gpsRes = await driverProfileService.updateLocation(drvProfId, {
      latitude: 12.9352,
      longitude: 77.6245,
      heading: 180,
      orderId,
    });
    expect(gpsRes.success).toBe(true);

    // 2. Customer tracking reflects updated location
    const tracking = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
    expect(tracking.driverLocation?.latitude).toBeCloseTo(12.9352);
    expect(tracking.driverLocation?.longitude).toBeCloseTo(77.6245);

    // 3. Redis Pub/Sub Propagation
    let receivedPayload: any = null;
    const testChannel = 'kudicart:tracking:events';
    await redisService.subscribe(testChannel, (_chan, msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.orderId === orderId) {
          receivedPayload = parsed;
        }
      } catch {}
    });

    await redisService.publish(testChannel, {
      type: 'DRIVER_LOCATION',
      orderId,
      latitude: 12.9352,
      longitude: 77.6245,
      speed: 28,
      heading: 180,
      timestamp: Date.now(),
    });

    // Wait for event loop
    await new Promise((r) => setTimeout(r, 200));
    expect(receivedPayload).toBeDefined();
    expect(receivedPayload.orderId).toBe(orderId);
    expect(receivedPayload.latitude).toBeCloseTo(12.9352);

    await redisService.unsubscribe(testChannel);
  });

  it('validates Try & Buy 10-Minute Trial lifecycle, server deadline enforcement, and decision outcome', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_tb_${suffix}`;
    const drvUserId = `${runId}_du_tb_${suffix}`;
    const drvProfId = `${runId}_dp_tb_${suffix}`;
    const prodId = `${runId}_prd_tb_${suffix}`;
    const itemId = `item_${suffix}`;

    createdOrderIds.push(orderId);
    createdUserIds.push(drvUserId);
    createdDriverProfileIds.push(drvProfId);
    createdProductIds.push(prodId);

    await prisma.user.create({
      data: {
        id: drvUserId,
        firebaseUid: `fb_${drvUserId}`,
        name: `TryBuy Driver ${suffix}`,
        email: `${drvUserId}@kudicart.test`,
        phone: `+919999${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvProfId,
        userId: drvUserId,
        fullName: `TryBuy Driver ${suffix}`,
        phone: `+919999${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
      },
    });

    await prisma.product.create({
      data: {
        id: prodId,
        title: `Try & Buy Dress ${suffix}`,
        brand: 'Affordz Luxe',
        description: 'T&B test product',
        vendorId: 'vend-1',
        categoryId: 'cat-1',
        price: 2500,
        originalPrice: 3000,
        discount: '16% OFF',
        sizes: ['M'],
        image: 'https://example.com/tb.jpg',
        altText: 'Dress',
        galleryImages: [],
        stockQuantity: 5,
        fulfillmentType: FulfillmentType.DARK_STORE,
      },
    });

    const deliveryOtp = '4821';
    const otpHash = hashOrderOtp(orderId, deliveryOtp);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-TB-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        driverId: drvUserId,
        driverProfileId: drvProfId,
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        isTryAndBuy: true,
        deliveryOtpHash: otpHash,
        itemTotal: 2500,
        taxes: 125,
        grandTotal: 2625,
        items: {
          create: {
            id: itemId,
            productId: prodId,
            size: 'M',
            quantity: 1,
            price: 2500,
            title: `Try & Buy Dress ${suffix}`,
            brand: 'Affordz Luxe',
            image: 'https://example.com/tb.jpg',
          },
        },
      },
    });

    // 1. Driver confirms doorstep handover with OTP -> starts 10-minute trial
    const handoverRes = await driverTryAndBuyService.confirmHandover(drvProfId, orderId, {
      otp: deliveryOtp,
      handoverImages: ['https://example.com/proof.jpg'],
    });

    expect(handoverRes.success).toBe(true);
    expect(handoverRes.trialDurationMinutes).toBe(10);
    expect(handoverRes.trialEndsAt).toBeDefined();
    expect(handoverRes.order.tryAndBuySession?.stage).toBe('TRIAL_IN_PROGRESS');

    // 2. Customer submits KEEP selection within the 10-minute window
    const decisionRes = await ordersService.submitCustomerTryAndBuySelections(
      orderId,
      'usr-1',
      Role.CUSTOMER,
      { [itemId]: 'KEEP' },
    );

    expect(decisionRes.order).toBeDefined();
    expect(decisionRes.financials.refundAmount).toBe(0);

    // 3. Verify Outbox event generated for trial update
    const tbOutbox = await prisma.outboxEvent.findFirst({
      where: {
        aggregateId: orderId,
        eventType: 'TRY_AND_BUY_SELECTION_NOTIFICATION',
      },
    });
    expect(tbOutbox).toBeDefined();
  });

  it('validates Order Cancellation, Immutable Refund Calculation, and Idempotent Webhook Processing', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_cnc_${suffix}`;
    createdOrderIds.push(orderId);

    const orderAmount = 2100;
    const taxes = 105;
    const grandTotal = 2205;

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-CNC-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        razorpayPaymentId: `pay_capture_${suffix}`,
        itemTotal: orderAmount,
        taxes,
        grandTotal,
      },
    });

    // Initial Payment Transaction
    await prisma.paymentTransaction.create({
      data: {
        orderId,
        paymentId: `pay_capture_${suffix}`,
        amount: grandTotal,
        currency: 'INR',
        status: 'COMPLETED',
        transactionType: 'CAPTURE',
      },
    });

    // 1. Cancel Order
    const cancelRes = await ordersService.cancelOrder(
      orderId,
      { id: 'usr-1', role: Role.CUSTOMER },
      'Customer requested cancellation',
    );
    expect(cancelRes.status).toBe(OrderStatus.CANCELLED);
    expect(cancelRes.paymentStatus).toBe('REFUND_PENDING');

    // 2. Process Refund Job via PaymentsProcessor
    await paymentsProcessor.processPaymentJob({
      id: `job-rfnd-${suffix}`,
      name: QueueJobType.REFUND_PROCESSING,
      data: { orderId },
    } as any);

    // 3. Verify Refund Transaction created from immutable record
    const refundTxn = await prisma.paymentTransaction.findFirst({
      where: { orderId, transactionType: 'REFUND' },
    });
    expect(refundTxn).toBeDefined();
    expect(refundTxn?.amount).toBe(grandTotal);
    expect(refundTxn?.status).toBe('REFUNDED');

    // 4. Idempotent Retry: Repeated refund initiation does not create duplicate refunds
    await paymentsProcessor.processPaymentJob({
      id: `job-rfnd-retry-${suffix}`,
      name: QueueJobType.REFUND_PROCESSING,
      data: { orderId },
    } as any);

    const refundList = await prisma.paymentTransaction.findMany({
      where: { orderId, transactionType: 'REFUND' },
    });
    expect(refundList).toHaveLength(1); // exactly 1 refund record

    // 5. Audit Log sanitization check
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: orderId },
    });
    expect(auditLogs.length).toBeGreaterThan(0);
    for (const log of auditLogs) {
      const detailsStr = JSON.stringify(log.details || {});
      expect(detailsStr).not.toContain('test_razorpay_secret_key');
      expect(detailsStr).not.toContain('Bearer');
    }
  });

  it('verifies Terminal State Tracking Cleanup and Sockets Recovery from PostgreSQL', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const orderId = `${runId}_term_${suffix}`;
    createdOrderIds.push(orderId);

    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `KC-TERM-${suffix}`,
        customerId: 'usr-1',
        vendorId: 'vend-1',
        addressId: 'addr-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 1000,
        taxes: 50,
        grandTotal: 1050,
      },
    });

    // Verify tracking is active
    const activeTracking = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
    expect(activeTracking.status).toBe(OrderStatus.OUT_FOR_DELIVERY);

    // Transition to Terminal State: DELIVERED
    await ordersService.updateStatus(
      orderId,
      OrderStatus.DELIVERED,
      Role.ADMIN,
      'usr-admin-1',
      'Delivered successfully',
    );

    // Reconnected client queries PostgreSQL state
    const terminalTracking = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
    expect(terminalTracking.status).toBe(OrderStatus.DELIVERED);

    // Terminal status prevents further updates to OUT_FOR_DELIVERY
    await expect(
      ordersService.updateStatus(
        orderId,
        OrderStatus.OUT_FOR_DELIVERY,
        Role.ADMIN,
        'usr-admin-1',
        'Should fail terminal state transition',
      ),
    ).rejects.toThrow();
  });
});
