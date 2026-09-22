import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { CartService } from './modules/cart/cart.service';
import { OrdersService } from './modules/orders/orders.service';
import { StateMachineService } from './modules/orders/state-machine.service';
import { PaymentsService } from './modules/payments/payments.service';

describe('KudiCart Backend Endpoints & State Machine', () => {
  let authService: AuthService;
  let catalogService: CatalogService;
  let cartService: CartService;
  let ordersService: OrdersService;
  let stateMachineService: StateMachineService;
  let paymentsService: PaymentsService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    catalogService = moduleRef.get<CatalogService>(CatalogService);
    cartService = moduleRef.get<CartService>(CartService);
    ordersService = moduleRef.get<OrdersService>(OrdersService);
    stateMachineService = moduleRef.get<StateMachineService>(StateMachineService);
    paymentsService = moduleRef.get<PaymentsService>(PaymentsService);
  });

  it('Auth: should send and verify OTP', async () => {
    const sendRes = await authService.sendOtp('+91 98450 12890');
    expect(sendRes.success).toBe(true);

    const verifyRes = await authService.verifyOtp('+91 98450 12890', '742900');
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.user.phone).toBe('+91 98450 12890');
  });

  it('Catalog: should fetch categories and products', async () => {
    const categories = await catalogService.getCategories();
    expect(categories.length).toBeGreaterThan(0);

    const products = await catalogService.getProducts();
    expect(products.length).toBeGreaterThan(0);
  });

  it('Cart: should calculate authoritative pricing breakdown', async () => {
    const cart = await cartService.getCart('usr-1');
    expect(cart.itemTotal).toBe(1299);
    expect(cart.deliveryFee).toBe(40);
    expect(cart.taxes).toBe(65);
    expect(cart.grandTotal).toBe(1404);
  });

  it('Order State Machine: should enforce valid 8-state transitions', () => {
    expect(stateMachineService.validateTransition('PLACED', 'ACCEPTED')).toBe(true);
    expect(stateMachineService.validateTransition('ACCEPTED', 'PREPARING')).toBe(true);
    expect(stateMachineService.validateTransition('PREPARING', 'READY_FOR_PICKUP')).toBe(true);
    expect(stateMachineService.validateTransition('READY_FOR_PICKUP', 'ASSIGNED')).toBe(true);
    expect(stateMachineService.validateTransition('ASSIGNED', 'PICKED_UP')).toBe(true);
    expect(stateMachineService.validateTransition('PICKED_UP', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(stateMachineService.validateTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);

    expect(() => stateMachineService.validateTransition('PLACED', 'DELIVERED')).toThrow();
  });

  it('Payments: should verify Razorpay signature', async () => {
    const res = await paymentsService.verifyRazorpaySignature('ord-89241', 'pay_123', 'sig_abc');
    expect(res.verified).toBe(true);
    expect(res.status).toBe('PAID');
  });
});
