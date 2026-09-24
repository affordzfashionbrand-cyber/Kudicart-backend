import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';
import { UsersService } from './modules/users/users.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { CartService } from './modules/cart/cart.service';
import { AddressService } from './modules/address/address.service';
import { OrdersService } from './modules/orders/orders.service';
import { StateMachineService } from './modules/orders/state-machine.service';
import { DriverService } from './modules/driver/driver.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ReviewsService } from './modules/reviews/reviews.service';
import { SupportService } from './modules/support/support.service';
import { PrismaService } from './prisma/prisma.service';
import { Role } from './common/enums/role.enum';

describe('KudiCart Backend — Customer & Driver Apps Full Business Logic & State Machine', () => {
  let authService: AuthService;
  let usersService: UsersService;
  let catalogService: CatalogService;
  let cartService: CartService;
  let addressService: AddressService;
  let ordersService: OrdersService;
  let stateMachineService: StateMachineService;
  let driverService: DriverService;
  let paymentsService: PaymentsService;
  let reviewsService: ReviewsService;
  let supportService: SupportService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    usersService = moduleRef.get<UsersService>(UsersService);
    catalogService = moduleRef.get<CatalogService>(CatalogService);
    cartService = moduleRef.get<CartService>(CartService);
    addressService = moduleRef.get<AddressService>(AddressService);
    ordersService = moduleRef.get<OrdersService>(OrdersService);
    stateMachineService = moduleRef.get<StateMachineService>(StateMachineService);
    driverService = moduleRef.get<DriverService>(DriverService);
    paymentsService = moduleRef.get<PaymentsService>(PaymentsService);
    reviewsService = moduleRef.get<ReviewsService>(ReviewsService);
    supportService = moduleRef.get<SupportService>(SupportService);
    prismaService = moduleRef.get<PrismaService>(PrismaService);
  });

  describe('1. Authentication Module', () => {
    it('Customer Auth: sends OTP and verifies with phone', async () => {
      const sendRes = await authService.sendOtp('+91 98450 12890');
      expect(sendRes.success).toBe(true);
      expect(sendRes.countdownSeconds).toBe(30);

      const verifyRes = await authService.verifyOtp('+91 98450 12890', '742900');
      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe(Role.CUSTOMER);
      expect(verifyRes.user.name).toBe('Ananya Sharma');
      expect(verifyRes.token).toBeDefined();
    });

    it('Driver Auth: identifies delivery partner by phone and returns driver profile', async () => {
      const verifyRes = await authService.verifyOtp('+91 98765 43210', '742900');
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
      const profile = await usersService.getProfile('usr-1');
      expect(profile.name).toBe('Ananya Sharma');

      const updated = await usersService.updateProfile('usr-1', {
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
      expect(kurtis.every((p) => p.category.toLowerCase() === 'kurtis')).toBe(true);

      const searched = await catalogService.getProducts({ search: 'Silk' });
      expect(searched.length).toBeGreaterThan(0);

      const sorted = await catalogService.getProducts({ sort: 'price_asc' });
      expect(sorted[0].price).toBeLessThanOrEqual(sorted[sorted.length - 1].price);
    });

    it('Catalog: fetches single product with vendor details', async () => {
      const product = await catalogService.getProductById('prod-1');
      expect(product.title).toContain('Anarkali');
      expect(product.vendor).toBeDefined();
      expect(product.vendor?.storeName).toBe('Avanya Ethnic Boutique');
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
    it('Cart: authoritative pricing breakdown (5% GST, ₹40 Delivery Fee)', async () => {
      const cart = await cartService.getCart('usr-1');
      expect(cart.itemTotal).toBe(1299);
      expect(cart.deliveryFee).toBe(40);
      expect(cart.taxes).toBe(65);
      expect(cart.grandTotal).toBe(1404);
    });

    it('Cart: prevents adding items when requested quantity exceeds available stock', async () => {
      const store = prismaService.getStore();
      const prod = store.products.find((p) => p.id === 'prod-1')!;
      prod.stockQuantity = 2; // Set low stock

      await expect(
        cartService.addItem('usr-1', 'prod-1', 'Size M', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('Cart: successfully adds and removes items', async () => {
      await cartService.clearCart('usr-1');
      let cart = await cartService.getCart('usr-1');
      expect(cart.items.length).toBe(0);

      await cartService.addItem('usr-1', 'prod-2', 'Free Size', 1);
      cart = await cartService.getCart('usr-1');
      expect(cart.items.length).toBe(1);
      expect(cart.items[0].productId).toBe('prod-2');
    });
  });

  describe('6. Orders, Checkout & Live Tracking', () => {
    it('Checkout: reserves stock, computes totals, places order in PLACED state, and clears cart', async () => {
      const store = prismaService.getStore();
      const product = store.products.find((p) => p.id === 'prod-1')!;
      product.stockQuantity = 10;

      await cartService.clearCart('usr-1');
      await cartService.addItem('usr-1', 'prod-1', 'Size M', 2);

      const initialStock = product.stockQuantity;

      const order = await ordersService.checkout('usr-1', {
        addressId: 'addr-1',
        paymentMethod: 'RAZORPAY',
      });

      expect(order.status).toBe('PLACED');
      expect(order.orderNumber).toMatch(/^KC-\d+/);
      expect(order.items.length).toBe(1);
      expect(order.items[0].quantity).toBe(2);

      // Verify stock was decremented
      expect(product.stockQuantity).toBe(initialStock - 2);

      // Verify cart was cleared
      const cart = await cartService.getCart('usr-1');
      expect(cart.items.length).toBe(0);
    });

    it('Checkout: rejects checkout with empty cart', async () => {
      await cartService.clearCart('usr-1');
      await expect(
        ordersService.checkout('usr-1', {
          addressId: 'addr-1',
          paymentMethod: 'COD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Live Tracking: produces 8 milestone states and rider information', async () => {
      const tracking = await ordersService.trackOrder('ord-89241');
      expect(tracking.milestones.length).toBe(8);
      expect(tracking.status).toBe('OUT_FOR_DELIVERY');

      // Milestone 7 (OUT_FOR_DELIVERY) should be active
      const activeMilestone = tracking.milestones.find((m) => m.key === 'OUT_FOR_DELIVERY');
      expect(activeMilestone?.status).toBe('active');

      // Milestones 1 to 6 should be completed
      const placedMilestone = tracking.milestones.find((m) => m.key === 'PLACED');
      expect(placedMilestone?.status).toBe('completed');

      // Driver details & location present
      expect(tracking.driver).toBeDefined();
      expect(tracking.driver?.name).toBe('Rajesh Kumar');
      expect(tracking.driver?.currentLocation).toBeDefined();
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
      const store = prismaService.getStore();
      const testOrder = store.orders[0];
      testOrder.status = 'READY_FOR_PICKUP';

      const updated = await ordersService.assignDriver(testOrder.id, 'drv-1', Role.ADMIN);
      expect(updated.status).toBe('ASSIGNED');
      expect(updated.driver?.name).toBe('Rajesh Kumar');
    });
  });

  describe('8. Driver App Module & Fulfillment Workflows', () => {
    it('Driver Profile & KYC: retrieves KYC documents and verification status', async () => {
      const profile = await driverService.getProfile('drv-1');
      expect(profile.name).toBe('Rajesh Kumar');
      expect(profile.vehicle).toContain('KA 03 EV 4821');

      const kyc = await driverService.getKycStatus('drv-1');
      expect(kyc.isApproved).toBe(true);
      expect(kyc.documents.length).toBe(3);
    });

    it('Driver Availability: toggles online/offline status', async () => {
      const res = await driverService.updateAvailability('drv-1', false);
      expect(res.isOnline).toBe(false);

      const resOnline = await driverService.updateAvailability('drv-1', true);
      expect(resOnline.isOnline).toBe(true);
    });

    it('Driver Assigned Orders: retrieves orders assigned to driver with pickup and dropoff packet', async () => {
      const orders = await driverService.getAssignedOrders('drv-1');
      expect(orders.length).toBeGreaterThan(0);
      expect(orders[0].pickupStore).toBeDefined();
      expect(orders[0].dropoffAddress).toBeDefined();

      const details = await driverService.getOrderDetails('drv-1', orders[0].id);
      expect(details.pickup.storeName).toBe('Avanya Ethnic Boutique');
      expect(details.dropoff.phone).toBe('+91 98450 12890');
    });

    it('Driver Workflow: executes Pickup -> Out for Delivery -> Deliver with COD payment collection', async () => {
      const store = prismaService.getStore();
      const testOrder = store.orders[0];
      testOrder.driverId = 'drv-1';
      testOrder.status = 'ASSIGNED';
      testOrder.paymentMethod = 'COD';
      testOrder.paymentStatus = 'PENDING';

      // 1. Accept
      const acceptRes = await driverService.acceptOrder('drv-1', testOrder.id);
      expect(acceptRes.success).toBe(true);

      // 2. Pickup
      const pickupRes = await driverService.pickupOrder('drv-1', testOrder.id);
      expect(pickupRes.order.status).toBe('PICKED_UP');

      // 3. Out for Delivery
      const outRes = await driverService.outForDeliveryOrder('drv-1', testOrder.id);
      expect(outRes.order.status).toBe('OUT_FOR_DELIVERY');

      // 4. Deliver
      const deliverRes = await driverService.deliverOrder('drv-1', testOrder.id);
      expect(deliverRes.order.status).toBe('DELIVERED');

      // Verify COD payment marked COMPLETED upon delivery
      expect(testOrder.paymentStatus).toBe('COMPLETED');
    });

    it('Driver Location: updates live telemetry for customer tracking', async () => {
      const locRes = await driverService.updateLocation('drv-1', {
        latitude: 12.9789,
        longitude: 77.6408,
        heading: 90,
      });

      expect(locRes.success).toBe(true);
      expect(locRes.location.latitude).toBe(12.9789);

      // Verify customer trackOrder sees updated coordinates
      const tracking = await ordersService.trackOrder('ord-89241');
      expect(tracking.driver?.currentLocation?.latitude).toBe(12.9789);
    });
  });

  describe('9. Payments Module (Razorpay & COD)', () => {
    it('Razorpay: creates payment order payload with correct paisa calculation', async () => {
      const rzpOrder = await paymentsService.createRazorpayOrder(1404, 'ord-89241');
      expect(rzpOrder.amountInPaisa).toBe(140400);
      expect(rzpOrder.currency).toBe('INR');
      expect(rzpOrder.keyId).toBeDefined();
    });

    it('Razorpay: verifies server-side signature and updates order payment state', async () => {
      const res = await paymentsService.verifyRazorpaySignature(
        'ord-89241',
        'pay_test_9921',
        'sig_abc',
      );
      expect(res.verified).toBe(true);
      expect(res.status).toBe('PAID');

      const store = prismaService.getStore();
      const order = store.orders.find((o) => o.id === 'ord-89241')!;
      expect(order.paymentStatus).toBe('COMPLETED');
      expect(order.razorpayPaymentId).toBe('pay_test_9921');
    });

    it('COD: confirms cash on delivery payment method', async () => {
      const res = await paymentsService.confirmCod('ord-89241');
      expect(res.confirmed).toBe(true);
      expect(res.paymentMethod).toBe('COD');
    });
  });

  describe('10. Reviews & Customer Feedback', () => {
    it('Reviews: allows customer to submit review for delivered product', async () => {
      const store = prismaService.getStore();
      const order = store.orders[0];
      order.status = 'DELIVERED';
      order.customerId = 'usr-1';

      const res = await reviewsService.createReview('usr-1', {
        orderId: order.id,
        productId: 'prod-1',
        rating: 5,
        comment: 'Truly gorgeous fabric and fits like a dream!',
      });

      expect(res.success).toBe(true);
      expect(res.review.rating).toBe(5);

      const reviews = await reviewsService.getReviewsForProduct('prod-1');
      expect(reviews.length).toBeGreaterThanOrEqual(1);
    });

    it('Reviews: rejects review if order is not delivered', async () => {
      const store = prismaService.getStore();
      const order = store.orders[0];
      order.status = 'PLACED';

      await expect(
        reviewsService.createReview('usr-1', {
          orderId: order.id,
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
        category: 'Delivery',
        orderId: 'ord-89241',
        description: 'Near BDA complex next to ICICI ATM',
      });

      expect(ticket.id).toBeDefined();
      expect(ticket.status).toBe('OPEN');

      const tickets = await supportService.getTickets('usr-1');
      expect(tickets.length).toBeGreaterThanOrEqual(1);
    });
  });
});
