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

import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';
import { UsersService } from './modules/users/users.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { CartService } from './modules/cart/cart.service';
import { AddressService } from './modules/address/address.service';
import { OrdersService } from './modules/orders/orders.service';
import { StateMachineService } from './modules/orders/state-machine.service';
import { DriverService } from './modules/driver/driver.service';
import { DriverAuthService } from './modules/driver/driver-auth.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ReviewsService } from './modules/reviews/reviews.service';
import { SupportService } from './modules/support/support.service';
import { PrismaService } from './prisma/prisma.service';
import { Role } from './common/enums/role.enum';

describe('KudiCart Backend — Customer & Driver Apps Full Business Logic & State Machine', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let usersService: UsersService;
  let catalogService: CatalogService;
  let cartService: CartService;
  let addressService: AddressService;
  let ordersService: OrdersService;
  let stateMachineService: StateMachineService;
  let driverService: DriverService;
  let driverAuthService: DriverAuthService;
  let paymentsService: PaymentsService;
  let reviewsService: ReviewsService;
  let supportService: SupportService;
  let prismaService: PrismaService;

  const prevRzpSecret = process.env.RAZORPAY_KEY_SECRET;
  const runId = `appspec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdOrderIds: string[] = [];
  const createdGroupIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdCouponIds: string[] = [];

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_SECRET = 'test_app_rzp_secret';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.init();

    authService = moduleRef.get<AuthService>(AuthService);
    usersService = moduleRef.get<UsersService>(UsersService);
    catalogService = moduleRef.get<CatalogService>(CatalogService);
    cartService = moduleRef.get<CartService>(CartService);
    addressService = moduleRef.get<AddressService>(AddressService);
    ordersService = moduleRef.get<OrdersService>(OrdersService);
    stateMachineService = moduleRef.get<StateMachineService>(StateMachineService);
    driverService = moduleRef.get<DriverService>(DriverService);
    driverAuthService = moduleRef.get<DriverAuthService>(DriverAuthService);
    paymentsService = moduleRef.get<PaymentsService>(PaymentsService);
    reviewsService = moduleRef.get<ReviewsService>(ReviewsService);
    supportService = moduleRef.get<SupportService>(SupportService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      const carts = await prismaService.cart.findMany({
        where: { userId: { in: createdUserIds } },
        select: { id: true },
      });
      if (carts.length > 0) {
        await prismaService.cartItem.deleteMany({
          where: { cartId: { in: carts.map((c) => c.id) } },
        });
        await prismaService.cart.deleteMany({
          where: { id: { in: carts.map((c) => c.id) } },
        });
      }
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
        where: { entityId: { in: [...createdOrderIds, ...createdGroupIds] } },
      });
      await prismaService.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prismaService.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prismaService.paymentTransaction.deleteMany({
        where: { checkoutGroupId: { in: createdGroupIds } },
      });
      await prismaService.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }
    if (createdCouponIds.length > 0) {
      await prismaService.coupon.deleteMany({
        where: { id: { in: createdCouponIds } },
      });
      createdCouponIds.length = 0;
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
    if (prevRzpSecret === undefined) {
      delete process.env.RAZORPAY_KEY_SECRET;
    } else {
      process.env.RAZORPAY_KEY_SECRET = prevRzpSecret;
    }
  });

  describe('1. Authentication Module', () => {
    it('Customer Auth: sends OTP and verifies with dynamically issued test OTP', async () => {
      const sendRes = await authService.sendOtp('+91 98450 12890');
      expect(sendRes.success).toBe(true);
      expect(sendRes.expiresIn).toBe(300);

      const otp = authService.getOtpForTesting('+91 98450 12890');
      expect(otp).toMatch(/^\d{6}$/);

      const verifyRes = await authService.verifyOtp('+91 98450 12890', otp!);
      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe(Role.CUSTOMER);
      expect(verifyRes.user.name).toBe('Ananya Sharma');
      expect(verifyRes.token).toBeDefined();
    });

    it('Customer Auth: logs in via Firebase ID token and returns authenticated JWT session', async () => {
      const fbRes = await authService.loginFirebase('mock-firebase-id-token-xyz');
      expect(fbRes.success).toBe(true);
      expect(fbRes.role).toBe(Role.CUSTOMER);
      expect(fbRes.token).toBeDefined();
      expect(fbRes.token.split('.').length).toBe(3);
      expect(fbRes.user.phone).toBe('+91 98450 12890');
    });

    it('Driver Auth: authenticates delivery partner via DriverAuthService and rejects driver phone on customer OTP verify', async () => {
      await authService.sendOtp('+91 98765 43210');
      const custOtp = authService.getOtpForTesting('+91 98765 43210')!;
      await expect(authService.verifyOtp('+91 98765 43210', custOtp)).rejects.toThrow(
        ForbiddenException,
      );

      await driverAuthService.sendOtp('+91 98765 43210');
      const drvOtp = driverAuthService.getOtpForTesting('+91 98765 43210')!;
      const verifyRes = await driverAuthService.verifyOtp('+91 98765 43210', drvOtp);
      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe(Role.DRIVER);
      expect(verifyRes.user.name).toBe('Rajesh Kumar');
      expect(verifyRes.user.driverId).toBe('drv-1');
      expect(verifyRes.user.kycStatus).toBe('APPROVED');
    });

    it('Auth validation: rejects invalid OTP', async () => {
      await expect(authService.verifyOtp('+91 98450 12890', '12')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('2. User & Profile Module', () => {
    it('Profile: retrieves and updates customer profile', async () => {
      const profUserId = `${runId}_prof_u`;
      createdUserIds.push(profUserId);
      await prismaService.user.create({
        data: {
          id: profUserId,
          firebaseUid: `fb_${profUserId}`,
          name: 'Ananya Sharma',
          email: `${profUserId}@test.kudicart.in`,
          phone: `+919870${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });

      const profile = await usersService.getProfile(profUserId);
      expect(profile.name).toBe('Ananya Sharma');

      const updated = await usersService.updateProfile(profUserId, {
        name: 'Ananya S. Rao',
      });
      expect(updated.name).toBe('Ananya S. Rao');
    });
  });

  describe('3. Catalog & Product Module', () => {
    it('Catalog: retrieves categories and active products with stock badges', async () => {
      const categories = await catalogService.getCategories();
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.find((c) => c.id === 'kurtis')).toBeDefined();

      const products = await catalogService.getProducts();
      expect(products.length).toBeGreaterThan(0);
      expect(products[0].stockBadge).toBeDefined();
    });

    it('Catalog: filters by category and search term with sorting', async () => {
      const kurtis = await catalogService.getProducts({ category: 'kurtis' });
      expect(kurtis.length).toBeGreaterThan(0);
      expect(
        kurtis.every(
          (p) =>
            p.categoryId === 'kurtis' || p.category.toLowerCase().includes('kurtis'),
        ),
      ).toBe(true);

      const searched = await catalogService.getProducts({ search: 'Silk' });
      expect(searched.length).toBeGreaterThan(0);

      const sorted = await catalogService.getProducts({ sort: 'price_asc' });
      expect(sorted[0].price).toBeLessThanOrEqual(sorted[sorted.length - 1].price);
    });

    it('Catalog Search: multi-token fuzzy and relevance search engine', async () => {
      // Multi-token: "mulmul kurti" matches Anarkali Set with Mulmul Silk & Kurti category
      const multiTokenResults = await catalogService.searchProducts({ search: 'mulmul kurti' });
      expect(multiTokenResults.length).toBeGreaterThan(0);
      expect(multiTokenResults[0].title).toContain('Anarkali');

      // Brand search: "Avanya"
      const brandResults = await catalogService.searchProducts({ search: 'Avanya' });
      expect(brandResults.length).toBeGreaterThan(0);
      expect(brandResults.every((p) => p.brand.toLowerCase().includes('avanya'))).toBe(true);

      // Filtered search: "silk" with fulfillmentType "DARK_STORE"
      const darkStoreSilk = await catalogService.searchProducts({
        search: 'silk',
        fulfillmentType: 'DARK_STORE',
      });
      expect(darkStoreSilk.every((p) => p.fulfillmentType === 'DARK_STORE')).toBe(true);
    });

    it('Catalog Suggestions: provides autocompletions, categories, brands, and instant picks', async () => {
      // 1. With search query "kur"
      const suggestions = await catalogService.getSearchSuggestions({ q: 'kur' });
      expect(suggestions.query).toBe('kur');
      expect(suggestions.suggestions.length).toBeGreaterThan(0);
      expect(suggestions.suggestions.some((s) => s.text.toLowerCase().includes('kur'))).toBe(true);
      expect(suggestions.recentPicks.length).toBeGreaterThan(0);

      // 2. Empty query returns trending searches & popular categories
      const emptySuggestions = await catalogService.getSearchSuggestions();
      expect(emptySuggestions.trending.length).toBeGreaterThan(0);
      expect(emptySuggestions.categories.length).toBeGreaterThan(0);
      expect(emptySuggestions.brands.length).toBeGreaterThan(0);
      expect(emptySuggestions.recentPicks.length).toBeGreaterThan(0);
    });

    it('Catalog: fetches single product with vendor details and dark store hub', async () => {
      const product = await catalogService.getProductById('prod-1');
      expect(product.title).toContain('Anarkali');
      expect(product.vendor).toBeDefined();
      expect(product.vendor?.storeName).toBe('Avanya Ethnic Boutique');
      expect(product.darkStoreHub).toBeDefined();
      expect(product.darkStoreHub?.deliveryMinutes).toBe(18);
    });

    it('Catalog: lists active Dark Store express fulfillment hubs', async () => {
      const hubs = await catalogService.getDarkStores();
      expect(hubs.length).toBe(2);
      expect(hubs.find((h) => h.locality.includes('Pozhichalur'))).toBeDefined();
      expect(hubs.find((h) => h.locality.includes('Tambaram'))).toBeDefined();
    });

    it('Catalog: filters by fulfillmentType (DARK_STORE vs VENDOR)', async () => {
      const darkStoreProducts = await catalogService.getProducts({ fulfillmentType: 'DARK_STORE' });
      expect(darkStoreProducts.length).toBeGreaterThan(0);
      expect(darkStoreProducts.every((p: any) => p.fulfillmentType === 'DARK_STORE')).toBe(true);

      const vendorProducts = await catalogService.getProducts({ fulfillmentType: 'VENDOR' });
      expect(vendorProducts.length).toBeGreaterThan(0);
      expect(vendorProducts.every((p: any) => p.fulfillmentType === 'VENDOR')).toBe(true);
    });

    it('Catalog: retrieves active coupons for customer checkout', async () => {
      const coupons = await catalogService.getActiveCoupons();
      expect(coupons.length).toBeGreaterThanOrEqual(2);
      expect(coupons.find((c) => c.code === 'AFFORDZ10')).toBeDefined();
      expect(coupons.find((c) => c.code === 'FIRSTDROP')).toBeDefined();
    });

    it('Catalog: calculates product counts and filters by price and pagination', async () => {
      const categories = await catalogService.getCategories();
      const kurtiCat = categories.find((c) => c.id === 'kurtis');
      expect(kurtiCat?.productCount).toBeGreaterThanOrEqual(1);
      expect(kurtiCat?.countText).toContain('styles');

      const cheapProducts = await catalogService.getProducts({ maxPrice: 1500 });
      expect(cheapProducts.every((p) => p.price <= 1500)).toBe(true);

      const paged = await catalogService.getProducts({ page: 1, limit: 1 });
      expect(paged.length).toBe(1);
    });
  });

  describe('4. Address Module', () => {
    it('Address CRUD: creates address, sets default, and lists customer addresses', async () => {
      const newAddr = await addressService.addAddress('usr-1', {
        label: 'Studio Workspace',
        line1: '12th Cross, 4th Main, HAL 2nd Stage',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560008',
        isDefault: true,
      });

      expect(newAddr.id).toBeDefined();
      expect(newAddr.isDefault).toBe(true);

      const addresses = await addressService.getAddresses('usr-1');
      expect(addresses.length).toBeGreaterThanOrEqual(2);

      // Verify previous default was unset
      const oldAddr = addresses.find((a) => a.id === 'addr-1');
      expect(oldAddr?.isDefault).toBe(false);
    });
  });

  describe('5. Cart & Stock Validation Module', () => {
    async function seedCartCustomerAndProduct(price = 1299, stockQuantity = 10) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_cart_u_${suffix}`;
      const prodId = `${runId}_cart_p_${suffix}`;
      createdUserIds.push(userId);
      createdProductIds.push(prodId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: `Cart Customer ${suffix}`,
          email: `${userId}@test.kudicart.in`,
          phone: `+919871${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });
      await prismaService.product.create({
        data: {
          id: prodId,
          title: `Test Silk Kurti ${suffix}`,
          brand: 'Avanya Ethnic',
          description: 'Cart test product',
          vendorId: 'vend-1',
          categoryId: 'cat-1',
          price,
          originalPrice: 1999,
          discount: '35% OFF',
          sizes: ['Size M', 'M', 'Free Size'],
          image: 'https://example.com/kurti.jpg',
          altText: 'Test Silk Kurti',
          galleryImages: [],
          stockQuantity,
          fulfillmentType: FulfillmentType.DARK_STORE,
          darkStoreHubId: 'hub-pozhichalur',
        },
      });
      return { userId, prodId };
    }

    it('Cart: authoritative pricing breakdown (5% GST, ₹40 Delivery Fee)', async () => {
      const { userId, prodId } = await seedCartCustomerAndProduct(1299, 10);
      await cartService.addItem(userId, prodId, 'Size M', 1);

      const cart = await cartService.getCart(userId);
      expect(cart.itemTotal).toBe(1299);
      expect(cart.deliveryFee).toBe(40);
      expect(cart.taxes).toBe(65);
      expect(cart.grandTotal).toBe(1404);
    });

    it('Cart: prevents adding items when requested quantity exceeds available stock', async () => {
      const { userId, prodId } = await seedCartCustomerAndProduct(1299, 2);

      await expect(
        cartService.addItem(userId, prodId, 'Size M', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('Cart: successfully adds and removes items', async () => {
      const { userId, prodId } = await seedCartCustomerAndProduct(899, 10);
      let cart = await cartService.getCart(userId);
      expect(cart.items.length).toBe(0);

      await cartService.addItem(userId, prodId, 'Free Size', 1);
      cart = await cartService.getCart(userId);
      expect(cart.items.length).toBe(1);
      expect(cart.items[0].productId).toBe(prodId);

      cart = await cartService.removeItem(userId, prodId);
      expect(cart.items.length).toBe(0);
    });

    it('Cart: applies coupon and calculates authoritative discount and free delivery above ₹1,499', async () => {
      const { userId, prodId } = await seedCartCustomerAndProduct(1299, 10);
      const couponId = `${runId}_cpn_${Math.random().toString(36).slice(2, 6)}`;
      const couponCode = `KC10_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      createdCouponIds.push(couponId);

      await prismaService.coupon.create({
        data: {
          id: couponId,
          code: couponCode,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          maxDiscount: 300,
          minOrderValue: 999,
          startDate: new Date(Date.now() - 86400_000),
          endDate: new Date(Date.now() + 86400_000),
          isActive: true,
        },
      });

      // Add items totaling >= 1499
      await cartService.addItem(userId, prodId, 'Size M', 2); // 1299 * 2 = 2598
      const cart = await cartService.getCart(userId);
      expect(cart.itemTotal).toBe(2598);
      expect(cart.deliveryFee).toBe(0); // Free above 1499

      // Apply 10% coupon (max 300) -> 260
      const couponRes = await cartService.applyCoupon(userId, couponCode);
      expect(couponRes.coupon).toBeDefined();
      expect(couponRes.coupon?.code).toBe(couponCode);
      expect(couponRes.discountAmount).toBe(260); // 10% of 2598 = 260
      expect(couponRes.grandTotal).toBe(2598 - 260 + 0 + Math.round(2598 * 0.05));

      // Remove coupon
      const removed = await cartService.removeCoupon(userId);
      expect(removed.coupon).toBeNull();
      expect(removed.discountAmount).toBe(0);
    });
  });

  describe('6. Orders, Checkout & Live Tracking', () => {
    async function seedOrderFixture(stockQuantity = 10, tryAndBuyEligible = false) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const userId = `${runId}_ord_u_${suffix}`;
      const addrId = `${runId}_ord_a_${suffix}`;
      const prodId = `${runId}_ord_p_${suffix}`;
      createdUserIds.push(userId);
      createdAddressIds.push(addrId);
      createdProductIds.push(prodId);

      await prismaService.user.create({
        data: {
          id: userId,
          firebaseUid: `fb_${userId}`,
          name: 'Ananya Sharma',
          email: `${userId}@test.kudicart.in`,
          phone: `+919872${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });
      await prismaService.address.create({
        data: {
          id: addrId,
          userId,
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+91 98450 12890',
          line1: '12 Main Road, Pozhichalur',
          locality: 'Pozhichalur',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600074',
          latitude: 12.9820,
          longitude: 80.1380,
        },
      });
      await prismaService.product.create({
        data: {
          id: prodId,
          title: `Silk Anarkali ${suffix}`,
          brand: 'Avanya Ethnic',
          description: 'Checkout fixture product',
          vendorId: 'vend-1',
          categoryId: 'cat-1',
          price: 1299,
          originalPrice: 1999,
          discount: '35% OFF',
          sizes: ['Size M', 'M', 'L'],
          image: 'https://example.com/anarkali.jpg',
          altText: 'Silk Anarkali',
          galleryImages: [],
          stockQuantity,
          tryAndBuyEligible,
          fulfillmentType: FulfillmentType.DARK_STORE,
          darkStoreHubId: 'hub-pozhichalur',
        },
      });
      return { userId, addrId, prodId };
    }

    it('Checkout: reserves stock, computes totals, places order in PLACED state, and clears cart', async () => {
      const { userId, addrId, prodId } = await seedOrderFixture(10);

      await cartService.addItem(userId, prodId, 'Size M', 2);

      const checkoutRes = await ordersService.checkout(userId, {
        addressId: addrId,
        paymentMethod: PaymentMethod.RAZORPAY,
      });

      expect(checkoutRes.orders).toHaveLength(1);
      const order = checkoutRes.orders[0];
      createdOrderIds.push(order.id);
      if (order.checkoutGroupId) {
        createdGroupIds.push(order.checkoutGroupId);
      }

      expect(order.status).toBe('PLACED');
      expect(order.orderNumber).toMatch(/^KC-/i);
      expect(order.items.length).toBe(1);
      expect(order.items[0].quantity).toBe(2);

      // Verify stock was decremented in PostgreSQL
      const refreshedProd = await prismaService.product.findUnique({ where: { id: prodId } });
      expect(refreshedProd?.stockQuantity).toBe(8);

      // Verify cart was cleared
      const cart = await cartService.getCart(userId);
      expect(cart.items.length).toBe(0);
    });

    it('Checkout: rejects checkout with empty cart', async () => {
      const { userId, addrId } = await seedOrderFixture(10);
      await cartService.clearCart(userId);
      await expect(
        ordersService.checkout(userId, {
          addressId: addrId,
          paymentMethod: PaymentMethod.COD,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Live Tracking: produces 8 milestone states and rider information', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const { userId, addrId } = await seedOrderFixture(5);
      const drvUserId = `${runId}_lt_du_${suffix}`;
      const drvProfId = `${runId}_lt_dp_${suffix}`;
      const orderId = `${runId}_lt_o_${suffix}`;
      createdUserIds.push(drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdOrderIds.push(orderId);

      await prismaService.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: 'Rajesh Kumar',
          email: `${drvUserId}@test.kudicart.in`,
          phone: `+919873${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: 'Rajesh Kumar',
          phone: `+919873${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: true,
          currentLat: 12.9789,
          currentLng: 77.6408,
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-LT-${suffix}`,
          customerId: userId,
          vendorId: 'vend-1',
          driverId: drvUserId,
          driverProfileId: drvProfId,
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
            latitude: 12.9784,
            longitude: 77.6408,
          },
          fulfillmentType: FulfillmentType.DARK_STORE,
          status: OrderStatus.OUT_FOR_DELIVERY,
          paymentMethod: PaymentMethod.RAZORPAY,
          paymentStatus: PaymentStatus.COMPLETED,
          itemTotal: 1299,
          taxes: 65,
          grandTotal: 1404,
        },
      });

      const tracking = await ordersService.trackOrder(orderId, userId, Role.CUSTOMER);
      expect(tracking.milestones.length).toBeGreaterThanOrEqual(7);
      expect(tracking.status).toBe('OUT_FOR_DELIVERY');

      // OUT_FOR_DELIVERY should be active
      const activeMilestone = tracking.milestones.find((m) => m.key === 'OUT_FOR_DELIVERY');
      expect(activeMilestone?.status).toBe('active');

      // PLACED should be completed
      const placedMilestone = tracking.milestones.find((m) => m.key === 'PLACED');
      expect(placedMilestone?.status).toBe('completed');

      // Driver details & location present
      expect(tracking.driver).toBeDefined();
      expect(tracking.driver?.name).toBe('Rajesh Kumar');
      expect(tracking.driverLocation).toBeDefined();
    });

    it('Checkout: supports Try & Buy flow and verifies payment with authoritative Razorpay HMAC signature', async () => {
      const { userId, addrId, prodId } = await seedOrderFixture(10, true);
      await cartService.addItem(userId, prodId, 'M', 1, 'L'); // with trialSize L

      const checkoutRes = await ordersService.checkout(userId, {
        addressId: addrId,
        paymentMethod: PaymentMethod.RAZORPAY,
        isTryAndBuy: true,
      });

      expect(checkoutRes.orders).toHaveLength(1);
      const order = checkoutRes.orders[0];
      createdOrderIds.push(order.id);
      if (order.checkoutGroupId) {
        createdGroupIds.push(order.checkoutGroupId);
      }

      expect(order.isTryAndBuy).toBe(true);
      expect(order.items[0].trialSize).toBe('L');
      expect(order.status).toBe('PLACED');

      const rzpOrderId = checkoutRes.razorpayOrderId || order.razorpayOrderId || '';
      expect(rzpOrderId).toBeTruthy();

      const paymentId = `pay_test_${Date.now()}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
        .update(`${rzpOrderId}|${paymentId}`)
        .digest('hex');

      // Verify payment
      const verifyRes = await ordersService.verifyPayment(
        order.id,
        paymentId,
        signature,
        rzpOrderId,
        userId,
        Role.CUSTOMER,
      );
      expect(verifyRes.verified).toBe(true);
      expect(verifyRes.paymentStatus).toBe('COMPLETED');

      const updatedOrder = await ordersService.getOrderById(order.id, userId, Role.CUSTOMER);
      expect(updatedOrder.status).toBe('PLACED');
      expect(updatedOrder.paymentStatus).toBe('COMPLETED');
    });
  });

  describe('7. Order 8-State Machine & Role Enforcement (D-034)', () => {
    it('State Machine: validates sequential transitions', () => {
      expect(stateMachineService.validateTransition('PLACED', 'ACCEPTED', Role.VENDOR)).toBe(true);
      expect(stateMachineService.validateTransition('ACCEPTED', 'PREPARING', Role.VENDOR)).toBe(true);
      expect(stateMachineService.validateTransition('PREPARING', 'READY_FOR_PICKUP', Role.VENDOR)).toBe(true);
      expect(stateMachineService.validateTransition('READY_FOR_PICKUP', 'ASSIGNED', Role.ADMIN)).toBe(true);
      expect(stateMachineService.validateTransition('ASSIGNED', 'PICKED_UP', Role.DRIVER)).toBe(true);
      expect(stateMachineService.validateTransition('PICKED_UP', 'OUT_FOR_DELIVERY', Role.DRIVER)).toBe(true);
      expect(stateMachineService.validateTransition('OUT_FOR_DELIVERY', 'DELIVERED', Role.DRIVER)).toBe(true);
    });

    it('State Machine: rejects non-sequential jumps (e.g. PLACED -> DELIVERED)', () => {
      expect(() => stateMachineService.validateTransition('PLACED', 'DELIVERED')).toThrow(
        BadRequestException,
      );
      expect(() => stateMachineService.validateTransition('PREPARING', 'DELIVERED')).toThrow(
        BadRequestException,
      );
    });

    it('State Machine: blocks unauthorized roles from making transitions', () => {
      // Driver cannot mark vendor order as PREPARING
      expect(() =>
        stateMachineService.validateTransition('ACCEPTED', 'PREPARING', Role.DRIVER),
      ).toThrow(ForbiddenException);

      // Customer cannot mark order as PICKED_UP
      expect(() =>
        stateMachineService.validateTransition('ASSIGNED', 'PICKED_UP', Role.CUSTOMER),
      ).toThrow(ForbiddenException);
    });

    it('Admin Manual Rider Assignment: assigns driver when READY_FOR_PICKUP (D-006)', async () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      const addrId = `${runId}_sm_a_${suffix}`;
      const orderId = `${runId}_sm_o_${suffix}`;
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.address.create({
        data: {
          id: addrId,
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Ananya Sharma',
          recipientPhone: '+919845012890',
          line1: '100 Feet Road',
          locality: 'Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-SM-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road',
            city: 'Bengaluru',
          },
          fulfillmentType: FulfillmentType.DARK_STORE,
          status: OrderStatus.READY_FOR_PICKUP,
          paymentMethod: PaymentMethod.COD,
          paymentStatus: PaymentStatus.PENDING,
          itemTotal: 1299,
          taxes: 65,
          grandTotal: 1404,
        },
      });

      const updated = await ordersService.assignDriver(orderId, 'drv-1', Role.ADMIN);
      expect(updated.status).toBe('ASSIGNED');
      expect(updated.driverName).toBe('Rajesh Kumar');
    });
  });

  describe('8. Driver App Module & Fulfillment Workflows', () => {
    async function seedDriverScenario(status: OrderStatus = OrderStatus.ASSIGNED) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const drvUserId = `${runId}_drv_u_${suffix}`;
      const drvProfId = `${runId}_drv_p_${suffix}`;
      const addrId = `${runId}_drv_a_${suffix}`;
      const orderId = `${runId}_drv_o_${suffix}`;
      createdUserIds.push(drvUserId);
      createdDriverProfileIds.push(drvProfId);
      createdAddressIds.push(addrId);
      createdOrderIds.push(orderId);

      await prismaService.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: `Test Driver ${suffix}`,
          email: `${drvUserId}@test.kudicart.in`,
          phone: `+919874${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prismaService.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: `Test Driver ${suffix}`,
          phone: `+919874${Math.floor(100000 + Math.random() * 899999)}`,
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
          recipientPhone: '+91 98450 12890',
          line1: '12 Main Road, Pozhichalur',
          locality: 'Pozhichalur',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600074',
          latitude: 12.9820,
          longitude: 80.1380,
        },
      });
      await prismaService.order.create({
        data: {
          id: orderId,
          orderNumber: `KC-DRV-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          driverId: drvUserId,
          driverProfileId: drvProfId,
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            phone: '+91 98450 12890',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
            latitude: 12.9784,
            longitude: 77.6408,
          },
          fulfillmentType: FulfillmentType.VENDOR,
          status,
          paymentMethod: PaymentMethod.COD,
          paymentStatus: PaymentStatus.PENDING,
          itemTotal: 1299,
          taxes: 65,
          grandTotal: 1404,
        },
      });

      return { drvUserId, drvProfId, orderId };
    }

    it('Driver Profile & KYC: retrieves KYC documents and verification status', async () => {
      const profile = await driverService.getProfile('drv-1');
      expect(profile.name).toBe('Rajesh Kumar');
      expect(profile.vehicle.registrationNumber).toContain('KA-01-KC-2026');

      const kyc = await driverService.getKycStatus('drv-1');
      expect(kyc.isApproved).toBe(true);
      expect(kyc.documents).toBeDefined();
    });

    it('Driver Availability: toggles online/offline status', async () => {
      const { drvProfId } = await seedDriverScenario();
      const res = await driverService.updateAvailability(drvProfId, false);
      expect(res.isOnline).toBe(false);

      const resOnline = await driverService.updateAvailability(drvProfId, true);
      expect(resOnline.isOnline).toBe(true);
    });

    it('Driver Assigned Orders: retrieves orders assigned to driver with pickup and dropoff packet', async () => {
      const { drvProfId, orderId } = await seedDriverScenario(OrderStatus.ASSIGNED);
      const assigned = await driverService.getAssignedOrders(drvProfId);
      expect(assigned.orders.length).toBeGreaterThan(0);
      expect(assigned.orders[0].pickupStore).toBeDefined();
      expect(assigned.orders[0].dropoffAddress).toBeDefined();

      const details = await driverService.getOrderDetails(drvProfId, orderId);
      expect(details.pickup.storeName).toBe('Avanya Ethnic Boutique');
      expect(details.dropoff.phone).toBeDefined();
    });

    it('Driver Workflow: executes Pickup -> Out for Delivery -> Deliver with COD payment collection', async () => {
      const { drvProfId, orderId } = await seedDriverScenario(OrderStatus.ASSIGNED);

      // 1. Accept
      const acceptRes = await driverService.acceptOrder(drvProfId, orderId);
      expect(acceptRes.success).toBe(true);

      // 2. Pickup
      const pickupRes = await driverService.pickupOrder(drvProfId, orderId);
      expect(pickupRes.order.status).toBe('PICKED_UP');

      // 3. Out for Delivery
      const outRes = await driverService.outForDeliveryOrder(drvProfId, orderId);
      expect(outRes.order.status).toBe('OUT_FOR_DELIVERY');

      // 4. Deliver with cash collected
      const deliverRes = await driverService.deliverOrder(drvProfId, orderId, {
        cashCollected: true,
      });
      expect(deliverRes.order.status).toBe('DELIVERED');
      expect(deliverRes.order.paymentStatus).toBe('COMPLETED');
    });

    it('Driver Location: updates live telemetry for customer tracking', async () => {
      const { drvProfId, orderId } = await seedDriverScenario(OrderStatus.OUT_FOR_DELIVERY);
      const locRes = await driverService.updateLocation(drvProfId, {
        latitude: 12.9789,
        longitude: 77.6408,
        heading: 90,
        orderId,
      });

      expect(locRes.success).toBe(true);
      expect(locRes.location.latitude).toBe(12.9789);

      // Verify customer trackOrder sees updated coordinates
      const tracking = await ordersService.trackOrder(orderId, 'usr-1', Role.CUSTOMER);
      expect(tracking.driverLocation?.latitude).toBe(12.9789);
    });
  });

  describe('9. Payments Module (Razorpay & COD)', () => {
    async function seedPayableOrder(paymentMethod: PaymentMethod = PaymentMethod.RAZORPAY) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const addrId = `${runId}_pay_a_${suffix}`;
      const orderId = `${runId}_pay_o_${suffix}`;
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
          orderNumber: `KC-PAY-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: FulfillmentType.DARK_STORE,
          status: OrderStatus.PLACED,
          paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          itemTotal: 1299,
          deliveryFee: 40,
          taxes: 65,
          grandTotal: 1404,
        },
      });
      return { orderId };
    }

    it('Razorpay: creates payment order payload with correct paisa calculation', async () => {
      const { orderId } = await seedPayableOrder(PaymentMethod.RAZORPAY);
      const rzpOrder = await paymentsService.createRazorpayOrder(1404, orderId);
      expect(rzpOrder.amount).toBe(140400);
      expect(rzpOrder.currency).toBe('INR');
      expect(rzpOrder.keyId).toBeDefined();
    });

    it('Razorpay: verifies server-side signature and updates order payment state', async () => {
      const { orderId } = await seedPayableOrder(PaymentMethod.RAZORPAY);
      const rzpOrder = await paymentsService.createRazorpayOrder(1404, orderId);
      const paymentId = `pay_app_${Date.now()}`;
      const sig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
        .update(`${rzpOrder.razorpayOrderId}|${paymentId}`)
        .digest('hex');

      const res = await paymentsService.verifyRazorpaySignature(
        orderId,
        paymentId,
        sig,
        rzpOrder.razorpayOrderId,
        'usr-1',
        Role.CUSTOMER,
      );
      expect(res.verified).toBe(true);
      expect(res.paymentStatus).toBe('COMPLETED');

      const refreshed = await prismaService.order.findUnique({ where: { id: orderId } });
      expect(refreshed?.paymentStatus).toBe('COMPLETED');
      expect(refreshed?.razorpayPaymentId).toBe(paymentId);
    });

    it('COD: confirms cash on delivery payment method', async () => {
      const { orderId } = await seedPayableOrder(PaymentMethod.COD);
      const res = await paymentsService.confirmCod(orderId, 'usr-1', Role.CUSTOMER);
      expect(res.success).toBe(true);
      expect(res.paymentMethod).toBe('COD');
      expect(res.paymentStatus).toBe('COMPLETED');
    });
  });

  describe('10. Reviews & Customer Feedback', () => {
    async function seedOrderWithItemForReview(status: OrderStatus) {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const orderId = `${runId}_rev_ord_${suffix}`;
      const addrId = `${runId}_rev_addr_${suffix}`;
      createdOrderIds.push(orderId);
      createdAddressIds.push(addrId);

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
          orderNumber: `KC-REV-${suffix}`,
          customerId: 'usr-1',
          vendorId: 'vend-1',
          addressId: addrId,
          deliveryAddress: {
            recipientName: 'Ananya Sharma',
            line1: '100 Feet Road, Indiranagar',
            city: 'Bengaluru',
          },
          fulfillmentType: FulfillmentType.DARK_STORE,
          status,
          paymentMethod: PaymentMethod.COD,
          paymentStatus: PaymentStatus.COMPLETED,
          itemTotal: 1299,
          deliveryFee: 0,
          taxes: 65,
          grandTotal: 1364,
          items: {
            create: {
              productId: 'prod-1',
              title: 'Linen Kurta',
              brand: 'Affordz Official Store',
              size: 'M',
              price: 1299,
              quantity: 1,
              image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800',
            },
          },
        },
      });

      return orderId;
    }

    it('Reviews: allows customer to submit review for delivered product', async () => {
      const orderId = await seedOrderWithItemForReview(OrderStatus.DELIVERED);

      const res = await reviewsService.createReview('usr-1', {
        orderId,
        productId: 'prod-1',
        rating: 5,
        comment: 'Truly gorgeous fabric and fits like a dream!',
      });

      expect(res.success).toBe(true);
      expect(res.review.rating).toBe(5);

      await prismaService.review.deleteMany({ where: { orderId } });

      const reviews = await reviewsService.getReviewsForProduct('prod-1');
      expect(Array.isArray(reviews)).toBe(true);
    });

    it('Reviews: rejects review if order is not delivered', async () => {
      const orderId = await seedOrderWithItemForReview(OrderStatus.PLACED);

      await expect(
        reviewsService.createReview('usr-1', {
          orderId,
          productId: 'prod-1',
          rating: 5,
          comment: 'Premature review attempt',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('11. Support Ticket Module', () => {
    it('Support: creates and lists customer support tickets', async () => {
      const ticket = await supportService.createTicket('usr-1', {
        title: 'Need to add landmark note for driver',
        category: 'Delivery & Rider Help',
        orderId: 'ord-89241',
        description: 'Near BDA complex next to ICICI ATM',
      });

      expect(ticket.id).toBeDefined();
      expect(ticket.status).toBe('OPEN');

      const tickets = await supportService.getTickets('usr-1');
      expect(tickets.length).toBeGreaterThanOrEqual(1);

      await prismaService.supportTicket.delete({ where: { id: ticket.id } });
    });
  });
});
