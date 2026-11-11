import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FulfillmentType,
  PaymentMethod,
} from '@prisma/client';
import * as express from 'express';
import request = require('supertest');
import * as WebSocket from 'ws';
import { AppModule } from '../../app.module';
import { Role } from '../../common/enums/role.enum';
import { createJwtToken } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';

jest.setTimeout(30000);

describe('Order Management End-to-End HTTP + WS + PostgreSQL Integration', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let wsBaseUrl: string;

  const runId = `om_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let phoneSeq = 100000;
  const nextPhone = () => `+919866${phoneSeq++}`;

  const createdUserIds: string[] = [];
  const createdVendorIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdCouponIds: string[] = [];
  const createdGroupIds: string[] = [];
  const createdOrderIds: string[] = [];

  function bearer(uid: string, role: Role): string {
    return `Bearer ${createJwtToken({ uid, role })}`;
  }

  async function seedActorAndCatalog() {
    const tag = Math.random().toString(36).slice(2, 6);
    const custId = `${runId}_cust_${tag}`;
    const outsiderId = `${runId}_out_${tag}`;
    const adminId = `${runId}_adm_${tag}`;
    const vendUserAId = `${runId}_vuA_${tag}`;
    const vendAId = `${runId}_vA_${tag}`;
    const vendUserBId = `${runId}_vuB_${tag}`;
    const vendBId = `${runId}_vB_${tag}`;
    const drvOkUserId = `${runId}_du1_${tag}`;
    const drvOkProfId = `${runId}_dp1_${tag}`;
    const drvPendUserId = `${runId}_du2_${tag}`;
    const drvPendProfId = `${runId}_dp2_${tag}`;
    const addrId = `${runId}_addr_${tag}`;
    const prodAId = `${runId}_pA_${tag}`;
    const prodBId = `${runId}_pB_${tag}`;
    const couponId = `${runId}_cpn_${tag}`;
    const couponCode = `OM10_${tag.toUpperCase()}`;

    createdUserIds.push(
      custId,
      outsiderId,
      adminId,
      vendUserAId,
      vendUserBId,
      drvOkUserId,
      drvPendUserId,
    );
    createdVendorIds.push(vendAId, vendBId);
    createdDriverProfileIds.push(drvOkProfId, drvPendProfId);
    createdAddressIds.push(addrId);
    createdProductIds.push(prodAId, prodBId);
    createdCouponIds.push(couponId);

    await prisma.user.createMany({
      data: [
        {
          id: custId,
          firebaseUid: `fb_${custId}`,
          name: 'Integration Customer',
          email: `${custId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        {
          id: outsiderId,
          firebaseUid: `fb_${outsiderId}`,
          name: 'Outsider Customer',
          email: `${outsiderId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        {
          id: adminId,
          firebaseUid: `fb_${adminId}`,
          name: 'Operations Admin',
          email: `${adminId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        {
          id: vendUserAId,
          firebaseUid: `fb_${vendUserAId}`,
          name: 'Vendor A Owner',
          email: `${vendUserAId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'VENDOR',
          status: 'ACTIVE',
        },
        {
          id: vendUserBId,
          firebaseUid: `fb_${vendUserBId}`,
          name: 'Vendor B Owner',
          email: `${vendUserBId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'VENDOR',
          status: 'ACTIVE',
        },
        {
          id: drvOkUserId,
          firebaseUid: `fb_${drvOkUserId}`,
          name: 'Approved Driver',
          email: `${drvOkUserId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'DRIVER',
          status: 'ACTIVE',
        },
        {
          id: drvPendUserId,
          firebaseUid: `fb_${drvPendUserId}`,
          name: 'Pending KYC Driver',
          email: `${drvPendUserId}@test.kudicart.in`,
          phone: nextPhone(),
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.vendor.create({
      data: {
        id: vendAId,
        userId: vendUserAId,
        storeName: `Express Store A ${tag}`,
        commissionRate: 12.5,
      },
    });
    await prisma.vendor.create({
      data: {
        id: vendBId,
        userId: vendUserBId,
        storeName: `Boutique Store B ${tag}`,
        commissionRate: 12.5,
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvOkProfId,
        userId: drvOkUserId,
        fullName: 'Approved Driver',
        phone: nextPhone(),
        kycStatus: 'APPROVED',
        isOnline: true,
        vehicleRegistration: 'KA-01-OM-1001',
      },
    });
    await prisma.driverProfile.create({
      data: {
        id: drvPendProfId,
        userId: drvPendUserId,
        fullName: 'Pending KYC Driver',
        phone: nextPhone(),
        kycStatus: 'PENDING',
        isOnline: true,
        vehicleRegistration: 'KA-01-OM-2002',
      },
    });

    await prisma.address.create({
      data: {
        id: addrId,
        userId: custId,
        label: 'Home',
        recipientName: 'Integration Customer',
        recipientPhone: '+91 98450 99887',
        line1: '100 Feet Road, Indiranagar',
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
        id: prodAId,
        title: `Dark Store Kurta ${tag}`,
        brand: 'KudiBrand A',
        description: 'Express dark store kurta',
        vendorId: vendAId,
        categoryId: 'cat-1',
        price: 1000,
        originalPrice: 1500,
        discount: '33% OFF',
        sizes: ['M', 'L'],
        image: 'https://example.com/pA.jpg',
        altText: 'Dark Store Kurta',
        galleryImages: [],
        stockQuantity: 10,
        tryAndBuyEligible: true,
        fulfillmentType: FulfillmentType.DARK_STORE,
        darkStoreHubId: 'hub-1',
      },
    });

    await prisma.product.create({
      data: {
        id: prodBId,
        title: `Boutique Lehenga ${tag}`,
        brand: 'KudiBrand B',
        description: 'Vendor store saree',
        vendorId: vendBId,
        categoryId: 'cat-1',
        price: 1200,
        originalPrice: 1800,
        discount: '33% OFF',
        sizes: ['M', 'Free Size'],
        image: 'https://example.com/pB.jpg',
        altText: 'Boutique Lehenga',
        galleryImages: [],
        stockQuantity: 10,
        tryAndBuyEligible: true,
        fulfillmentType: FulfillmentType.VENDOR,
      },
    });

    await prisma.coupon.create({
      data: {
        id: couponId,
        code: couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscount: 500,
        minOrderValue: 500,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 86400_000),
        isActive: true,
      },
    });

    return {
      custId,
      outsiderId,
      adminId,
      vendUserAId,
      vendAId,
      vendUserBId,
      vendBId,
      drvOkUserId,
      drvOkProfId,
      drvPendUserId,
      drvPendProfId,
      addrId,
      prodAId,
      prodBId,
      couponCode,
    };
  }

  async function trackCreatedFromCheckout(body: any) {
    if (body?.checkoutGroupId && !createdGroupIds.includes(body.checkoutGroupId)) {
      createdGroupIds.push(body.checkoutGroupId);
    }
    if (Array.isArray(body?.orders)) {
      for (const ord of body.orders) {
        if (ord?.id && !createdOrderIds.includes(ord.id)) {
          createdOrderIds.push(ord.id);
        }
      }
    }
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);

    const addr = app.getHttpServer().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    wsBaseUrl = `ws://127.0.0.1:${port}/ws/tracking`;

    prisma = moduleRef.get(PrismaService);
  });

  afterEach(async () => {
    const trackedOrders = [...createdOrderIds];
    if (createdGroupIds.length > 0) {
      const grpOrders = await prisma.order.findMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
        select: { id: true },
      });
      for (const o of grpOrders) {
        if (!trackedOrders.includes(o.id)) trackedOrders.push(o.id);
      }
    }

    if (createdUserIds.length > 0) {
      await prisma.idempotencyKey.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      const carts = await prisma.cart.findMany({
        where: { userId: { in: createdUserIds } },
        select: { id: true },
      });
      const cartIds = carts.map((c) => c.id);
      if (cartIds.length > 0) {
        await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } });
        await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
      }
    }

    if (trackedOrders.length > 0) {
      await prisma.tryAndBuySession.deleteMany({
        where: { orderId: { in: trackedOrders } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: [...trackedOrders, ...createdGroupIds] } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { orderId: { in: trackedOrders } },
      });
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: trackedOrders } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: trackedOrders } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...trackedOrders, ...createdGroupIds] } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: trackedOrders } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: trackedOrders } },
      });
      createdOrderIds.length = 0;
    }

    if (createdGroupIds.length > 0) {
      await prisma.paymentTransaction.deleteMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
      });
      await prisma.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }

    if (createdCouponIds.length > 0) {
      await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
      createdCouponIds.length = 0;
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      createdProductIds.length = 0;
    }
    if (createdAddressIds.length > 0) {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } });
      createdAddressIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prisma.driverDocument.deleteMany({
        where: { driverId: { in: createdDriverProfileIds } },
      });
      await prisma.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdVendorIds.length > 0) {
      await prisma.vendorPayout.deleteMany({
        where: { vendorId: { in: createdVendorIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { vendorId: { in: createdVendorIds } },
      });
      await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } });
      createdVendorIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Readiness Probe: /health/ready reports live PostgreSQL database health over HTTP', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.database).toBeDefined();
    expect(['UP', 'CONNECTED', 'OK', 'HEALTHY'].includes(String(res.body.database.status).toUpperCase()) || res.body.status === 'ok').toBe(true);
  });

  it('Multi-Vendor Split Checkout: computes server totals, pro-rata coupon, ₹35 gift wrap, donation, free delivery threshold, and rejects client price spoofing', async () => {
    const ctx = await seedActorAndCatalog();
    const custToken = bearer(ctx.custId, Role.CUSTOMER);
    const outsiderToken = bearer(ctx.outsiderId, Role.CUSTOMER);

    // Add DARK_STORE (₹1000) + VENDOR (₹1200) items to cart
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodBId, size: 'M', quantity: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/cart/coupons/apply')
      .set('Authorization', custToken)
      .send({ code: ctx.couponCode })
      .expect(200);

    // Attempt price tampering via itemTotal/grandTotal in request body
    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .send({
        addressId: ctx.addrId,
        paymentMethod: PaymentMethod.COD,
        couponCode: ctx.couponCode,
        giftWrap: true,
        donationAmount: 25,
        itemTotal: 1,
        deliveryFee: 0,
        taxes: 0,
        grandTotal: 1,
      })
      .expect(201);

    await trackCreatedFromCheckout(checkoutRes.body);

    expect(checkoutRes.body.checkoutGroupId).toBeTruthy();
    expect(checkoutRes.body.orders).toHaveLength(2);

    const darkOrder = checkoutRes.body.orders.find(
      (o: any) => o.fulfillmentType === FulfillmentType.DARK_STORE,
    );
    const vendorOrder = checkoutRes.body.orders.find(
      (o: any) => o.fulfillmentType === FulfillmentType.VENDOR,
    );
    expect(darkOrder).toBeDefined();
    expect(vendorOrder).toBeDefined();

    // Order 0 (index 0) gets ₹35 giftWrapFee; both orders < ₹1,499 get ₹40 delivery; 10% coupon (220) pro-rated [100, 120]
    const firstOrder = checkoutRes.body.orders[0];
    const secondOrder = checkoutRes.body.orders[1];
    expect(firstOrder.giftWrapFee).toBe(35);
    expect(secondOrder.giftWrapFee).toBe(0);
    expect(darkOrder.itemTotal).toBe(1000);
    expect(darkOrder.deliveryFee).toBe(40);
    expect(darkOrder.taxes).toBe(50);
    expect(darkOrder.discountAmount).toBe(100);

    expect(vendorOrder.itemTotal).toBe(1200);
    expect(vendorOrder.deliveryFee).toBe(40);
    expect(vendorOrder.taxes).toBe(60);
    expect(vendorOrder.discountAmount).toBe(120);

    // Group totals: 2200 itemTotal + 80 delivery + 110 tax + 35 giftWrap + 25 donation - 220 discount = 2230
    expect(checkoutRes.body.grandTotal).toBe(2230);
    expect(checkoutRes.body.donationAmount).toBe(25);

    // Group RBAC check: owner succeeds, outsider blocked 403
    await request(app.getHttpServer())
      .get(`/api/v1/orders/groups/${checkoutRes.body.checkoutGroupId}`)
      .set('Authorization', custToken)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/orders/groups/${checkoutRes.body.checkoutGroupId}`)
      .set('Authorization', outsiderToken)
      .expect(403);

    // Free delivery threshold >= ₹1,499 (qty 2 * ₹1000 = ₹2000 -> ₹0 delivery)
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 2 })
      .expect(200);

    const freeDelivRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .send({
        addressId: ctx.addrId,
        paymentMethod: PaymentMethod.RAZORPAY,
      })
      .expect(201);

    await trackCreatedFromCheckout(freeDelivRes.body);
    expect(freeDelivRes.body.orders[0].itemTotal).toBe(2000);
    expect(freeDelivRes.body.orders[0].deliveryFee).toBe(0);
    expect(freeDelivRes.body.razorpayOrderId).toBeTruthy();
  });

  it('Checkout Idempotency: replays identical response without double decrementing stock and rejects payload drift with 409', async () => {
    const ctx = await seedActorAndCatalog();
    const custToken = bearer(ctx.custId, Role.CUSTOMER);
    const idempotencyKey = `idem_${runId}_${Date.now()}`;

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 2 })
      .expect(200);

    const payload = {
      addressId: ctx.addrId,
      paymentMethod: PaymentMethod.COD,
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    await trackCreatedFromCheckout(first.body);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(replay.body.checkoutGroupId).toBe(first.body.checkoutGroupId);
    expect(replay.body.orders[0].id).toBe(first.body.orders[0].id);

    // Stock should have decremented only once (10 - 2 = 8)
    const prod = await prisma.product.findUnique({ where: { id: ctx.prodAId } });
    expect(prod?.stockQuantity).toBe(8);

    // Mismatched payload under same Idempotency-Key returns 409 Conflict
    await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, paymentMethod: PaymentMethod.RAZORPAY })
      .expect(409);
  });

  it('Concurrency Guards: prevents stock oversell across parallel checkouts and rejects stale expectedVersion with 409', async () => {
    const ctx = await seedActorAndCatalog();
    await prisma.product.update({
      where: { id: ctx.prodAId },
      data: { stockQuantity: 1 },
    });

    const custAddr2 = `${runId}_addr2_${Date.now()}`;
    createdAddressIds.push(custAddr2);
    await prisma.address.create({
      data: {
        id: custAddr2,
        userId: ctx.outsiderId,
        label: 'Work',
        recipientName: 'Second Customer',
        recipientPhone: '+91 98450 55443',
        line1: 'Indiranagar 12th Main',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
        latitude: 12.978,
        longitude: 77.641,
      },
    });

    const token1 = bearer(ctx.custId, Role.CUSTOMER);
    const token2 = bearer(ctx.outsiderId, Role.CUSTOMER);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', token1)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', token2)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 1 })
      .expect(200);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', token1)
        .send({ addressId: ctx.addrId, paymentMethod: PaymentMethod.COD }),
      request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', token2)
        .send({ addressId: custAddr2, paymentMethod: PaymentMethod.COD }),
    ]);

    await trackCreatedFromCheckout(r1.body);
    await trackCreatedFromCheckout(r2.body);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);

    const finalProd = await prisma.product.findUnique({ where: { id: ctx.prodAId } });
    expect(finalProd?.stockQuantity).toBe(0);

    const winningOrderId = r1.status === 201 ? r1.body.orders[0].id : r2.body.orders[0].id;
    const vendAToken = bearer(ctx.vendUserAId, Role.VENDOR);

    // Stale optimistic concurrency version -> 409 Conflict
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${winningOrderId}/status`)
      .set('Authorization', vendAToken)
      .send({ status: 'ACCEPTED', expectedVersion: 99 })
      .expect(409);
  });

  it('Role-Gated State Machine & Manual Dispatch (D-006 / D-034): enforces vendor isolation, manual admin assignment, KYC verification, and WS realtime Try & Buy full return reconciliation with balanced 12.5% LedgerEntry', async () => {
    const ctx = await seedActorAndCatalog();
    const custToken = bearer(ctx.custId, Role.CUSTOMER);
    const vendAToken = bearer(ctx.vendUserAId, Role.VENDOR);
    const vendBToken = bearer(ctx.vendUserBId, Role.VENDOR);
    const adminToken = bearer(ctx.adminId, Role.ADMIN);
    const drvOkToken = bearer(ctx.drvOkUserId, Role.DRIVER);
    const drvPendToken = bearer(ctx.drvPendUserId, Role.DRIVER);

    // Add item from vendA (₹1000) and vendA-eligible second product (move prodB temporarily to vendA for 2-item Try & Buy on same order)
    await prisma.product.update({
      where: { id: ctx.prodBId },
      data: {
        vendorId: ctx.vendAId,
        fulfillmentType: FulfillmentType.DARK_STORE,
        darkStoreHubId: 'hub-1',
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodAId, size: 'M', quantity: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', custToken)
      .send({ productId: ctx.prodBId, size: 'M', quantity: 1 })
      .expect(200);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', custToken)
      .send({
        addressId: ctx.addrId,
        paymentMethod: PaymentMethod.COD,
        isTryAndBuy: true,
      })
      .expect(201);

    await trackCreatedFromCheckout(checkoutRes.body);
    expect(checkoutRes.body.orders).toHaveLength(1);
    const order = checkoutRes.body.orders[0];
    const orderId = order.id;

    // Cross-actor RBAC checks: customer and wrong vendor cannot transition order
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', custToken)
      .send({ status: 'ACCEPTED' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', vendBToken)
      .send({ status: 'ACCEPTED' })
      .expect(403);

    // Cannot skip PLACED -> DELIVERED
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', vendAToken)
      .send({ status: 'DELIVERED' })
      .expect(400);

    // Connect authenticated WebSocket subscriber on single-port /ws/tracking
    const receivedWsStatuses: string[] = [];
    const ws = new WebSocket(
      `${wsBaseUrl}?token=${encodeURIComponent(`test-firebase-id-token:${ctx.custId}::${ctx.custId}@test.kudicart.in`)}`,
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', orderId }));
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.orderId === orderId && msg?.status) {
          receivedWsStatuses.push(msg.status);
        }
      } catch {
        // ignore parse errors
      }
    });

    try {
      // Vendor A sequential prep: PLACED -> ACCEPTED -> PREPARING -> READY_FOR_PICKUP
      await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', vendAToken)
        .send({ status: 'ACCEPTED', expectedVersion: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', vendAToken)
        .send({ status: 'PREPARING', expectedVersion: 2 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', vendAToken)
        .send({ status: 'READY_FOR_PICKUP', expectedVersion: 3 })
        .expect(200);

      // Manual dispatch only (D-006): Vendor cannot assign driver (403)
      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${orderId}/assign-driver`)
        .set('Authorization', vendAToken)
        .send({ driverId: ctx.drvOkProfId })
        .expect(403);

      // Admin cannot assign driver whose KYC is PENDING
      const kycFail = await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${orderId}/assign-driver`)
        .set('Authorization', adminToken)
        .send({ driverId: ctx.drvPendProfId });
      expect([400, 409]).toContain(kycFail.status);

      // Admin assigns approved driver manually
      await request(app.getHttpServer())
        .post(`/api/v1/admin/orders/${orderId}/assign-driver`)
        .set('Authorization', adminToken)
        .send({ driverId: ctx.drvOkProfId })
        .expect(200);

      // Unassigned driver cannot pickup order (403)
      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/pickup`)
        .set('Authorization', drvPendToken)
        .send({})
        .expect(403);

      // Assigned driver: pickup -> out-for-delivery -> arrived (DCR-005 keeps OUT_FOR_DELIVERY)
      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/pickup`)
        .set('Authorization', drvOkToken)
        .send({ packageImages: ['https://example.com/pkg.jpg'] })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/out-for-delivery`)
        .set('Authorization', drvOkToken)
        .send()
        .expect(200);

      const arrivedRes = await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/arrived`)
        .set('Authorization', drvOkToken)
        .send()
        .expect(200);

      expect(arrivedRes.body.order.status).toBe('OUT_FOR_DELIVERY');
      expect(arrivedRes.body.arrivedAt).toBeTruthy();

      // Customer reads authoritative handoverOtp from GET /api/v1/orders/:id
      const custOrderRes = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', custToken)
        .expect(200);
      const handoverOtp = custOrderRes.body.handoverOtp;
      expect(handoverOtp).toMatch(/^\d{4}$/);

      // Wrong OTP rejected
      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/handover`)
        .set('Authorization', drvOkToken)
        .send({ otp: handoverOtp === '0000' ? '1111' : '0000' })
        .expect(400);

      // Valid salted handover OTP succeeds -> TRIAL_IN_PROGRESS
      const handoverRes = await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/handover`)
        .set('Authorization', drvOkToken)
        .send({ otp: handoverOtp, handoverImages: ['https://example.com/handover.jpg'] })
        .expect(200);
      expect(handoverRes.body.success).toBe(true);
      expect(handoverRes.body.order.tryAndBuySession.stage).toBe('TRIAL_IN_PROGRESS');

      // Customer keeps ₹1000 item A, returns ₹1200 item B
      const itemA = order.items.find((i: any) => i.productId === ctx.prodAId);
      const itemB = order.items.find((i: any) => i.productId === ctx.prodBId);
      const selRes = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/try-and-buy/customer-selections`)
        .set('Authorization', custToken)
        .send({
          selections: {
            [itemA.id]: 'KEEP',
            [itemB.id]: 'RETURN',
          },
        })
        .expect(200);
      expect(selRes.body.order.tryAndBuySession.keptItemIds).toEqual([itemA.id]);
      expect(selRes.body.order.tryAndBuySession.returnedItemIds).toEqual([itemB.id]);

      // Driver collects returned item -> settles COD payment (RETURNING) -> arrives at store -> supervisor reconciles (RETURNED)
      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/return-collection`)
        .set('Authorization', drvOkToken)
        .send({ collectedItemIds: [itemB.id], returnImages: ['https://example.com/ret.jpg'] })
        .expect(200);

      const settleRes = await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/settle-payment`)
        .set('Authorization', drvOkToken)
        .send({ cashCollected: true })
        .expect(200);
      expect(settleRes.body.orderStatus).toBe('RETURNING');

      await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/arrive-store`)
        .set('Authorization', drvOkToken)
        .send()
        .expect(200);

      const reconcileRes = await request(app.getHttpServer())
        .post(`/api/v1/driver/orders/${orderId}/try-and-buy/reconcile-store`)
        .set('Authorization', drvOkToken)
        .send({ supervisorConfirmed: true, note: 'All returned garments intact' })
        .expect(200);
      expect(reconcileRes.body.order.status).toBe('RETURNED');

      // Double-entry 12.5% LedgerEntry verification for kept item subtotal (₹1000)
      const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { orderId } });
      const rev = ledgerEntries.find((e) => e.entryType === 'ORDER_REVENUE');
      const comm = ledgerEntries.find((e) => e.entryType === 'COMMISSION_DEDUCTED');
      const payout = ledgerEntries.find((e) => e.entryType === 'VENDOR_PAYOUT');
      expect(rev).toBeDefined();
      expect(comm).toBeDefined();
      expect(payout).toBeDefined();
      expect(rev!.amount).toBe(1000);
      expect(comm!.amount).toBe(-125); // 12.5% of 1000
      expect(payout!.amount).toBe(875);
      expect(Math.abs(comm!.amount) + payout!.amount).toBe(rev!.amount);

      // Verify complete OrderStatusHistory + AuditLog + WS broadcast
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      const historyStatuses = history.map((h) => h.status);
      expect(historyStatuses).toEqual([
        'PLACED',
        'ACCEPTED',
        'PREPARING',
        'READY_FOR_PICKUP',
        'ASSIGNED',
        'PICKED_UP',
        'OUT_FOR_DELIVERY',
        'RETURNING',
        'RETURNED',
      ]);

      const assignAudit = await prisma.auditLog.findFirst({
        where: { entityId: orderId, action: 'ADMIN_MANUAL_DRIVER_ASSIGNED' },
      });
      expect(assignAudit).toBeDefined();

      // Wait briefly for final WS broadcasts if any are in flight
      await new Promise((r) => setTimeout(r, 150));
      expect(receivedWsStatuses).toEqual(
        expect.arrayContaining(['ACCEPTED', 'READY_FOR_PICKUP', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'RETURNED']),
      );
    } finally {
      ws.close();
    }
  });
});
