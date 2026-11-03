import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';
import {
  createJwtToken,
  verifyJwtToken,
  hashPassword,
  verifyPassword,
  getJwtSecret,
} from '../../common/utils/crypto.util';
import { FirebaseAdminService } from './firebase-admin.service';
import { AuthService } from './auth.service';
import { DriverAuthService } from '../driver/driver-auth.service';
import { AdminAuthService } from '../admin/services/admin-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { DispatchService } from '../orders/dispatch.service';
import { AppModule } from '../../app.module';

describe('Phase 1 — Authentication, RBAC & Security Specification', () => {
  let app: TestingModule;
  let authGuard: FirebaseAuthGuard;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;
  let firebaseAdmin: FirebaseAdminService;
  let authService: AuthService;
  let driverAuthService: DriverAuthService;
  let adminAuthService: AdminAuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authGuard = app.get<FirebaseAuthGuard>(FirebaseAuthGuard);
    rolesGuard = new RolesGuard(app.get<Reflector>(Reflector));
    reflector = app.get<Reflector>(Reflector);
    firebaseAdmin = app.get<FirebaseAdminService>(FirebaseAdminService);
    authService = app.get<AuthService>(AuthService);
    driverAuthService = app.get<DriverAuthService>(DriverAuthService);
    adminAuthService = app.get<AdminAuthService>(AdminAuthService);
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Cryptographic Token Integrity (crypto.util)', () => {
    it('creates a standard 3-part HMAC-SHA256 JWT', () => {
      const token = createJwtToken({ uid: 'usr-test-1', role: Role.CUSTOMER });
      expect(token).toBeDefined();
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });

    it('verifies a valid signed JWT correctly', () => {
      const token = createJwtToken({ uid: 'usr-test-1', role: Role.CUSTOMER });
      const result = verifyJwtToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload.uid).toBe('usr-test-1');
      expect(result.payload.role).toBe(Role.CUSTOMER);
    });

    it('rejects forged JWT with modified payload (signature mismatch)', () => {
      const token = createJwtToken({ uid: 'usr-test-1', role: Role.CUSTOMER });
      const parts = token.split('.');
      // Tamper with payload to elevate role to ADMIN
      const tamperedPayload = Buffer.from(
        JSON.stringify({ uid: 'usr-test-1', role: Role.ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url');
      const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = verifyJwtToken(forgedToken);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid token signature|Signature verification failed/);
    });

    it('rejects forged JWT signed with an untrusted secret', () => {
      const forgedToken = createJwtToken(
        { uid: 'attacker-1', role: Role.ADMIN },
        'attacker_compromised_secret_key_123',
      );
      const result = verifyJwtToken(forgedToken); // verifies against server getJwtSecret()
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid token signature|Signature verification failed/);
    });

    it('rejects expired JWT tokens', () => {
      const expiredToken = createJwtToken(
        { uid: 'usr-1', role: Role.CUSTOMER },
        undefined,
        -10, // expired 10 seconds ago
      );
      const result = verifyJwtToken(expiredToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    it('hashes passwords using PBKDF2 with salt and verifies safely', () => {
      const password = 'SuperSecurePassword2026!';
      const hash = hashPassword(password);
      expect(hash).toContain(':');
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword('WrongPassword', hash)).toBe(false);
    });
  });

  describe('2. Firebase Admin Token Verification', () => {
    it('fails closed when given empty or non-string token', async () => {
      await expect(firebaseAdmin.verifyIdToken('')).rejects.toThrow(UnauthorizedException);
    });

    it('verifies test tokens in test environment safely', async () => {
      const testToken = 'test-firebase-id-token:fb-cust-999:+919845012345:cust@kudicart.in';
      const decoded = await firebaseAdmin.verifyIdToken(testToken);
      expect(decoded.uid).toBe('fb-cust-999');
      expect(decoded.phoneNumber).toBe('+919845012345');
      expect(decoded.email).toBe('cust@kudicart.in');
    });

    it('fails closed when token verification fails or service is uninitialized', async () => {
      await expect(firebaseAdmin.verifyIdToken('invalid.firebase.token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('3. FirebaseAuthGuard Fail-Closed Enforcement', () => {
    const createMockContext = (authHeader?: string, url: string = '/api/v1/users/me') => {
      const mockRequest: any = {
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
        url,
        originalUrl: url,
      };
      return {
        context: {
          switchToHttp: () => ({ getRequest: () => mockRequest }),
          getHandler: () => {},
          getClass: () => {},
        } as any,
        request: mockRequest,
      };
    };

    it('rejects missing Authorization header with 401 Unauthorized', async () => {
      const { context } = createMockContext(undefined);
      await expect(Promise.resolve().then(() => authGuard.canActivate(context))).rejects.toThrow(UnauthorizedException);
    });

    it('rejects non-Bearer format (e.g. Basic) with 401 Unauthorized', async () => {
      const { context } = createMockContext('Basic dXNlcjpwYXNz');
      await expect(Promise.resolve().then(() => authGuard.canActivate(context))).rejects.toThrow(UnauthorizedException);
    });

    it('rejects mock and debug tokens in runtime paths', async () => {
      const mockTokens = ['Bearer mock-token-123', 'Bearer test_token', 'Bearer driver', 'Bearer admin'];
      for (const token of mockTokens) {
        const { context } = createMockContext(token);
        await expect(Promise.resolve().then(() => authGuard.canActivate(context))).rejects.toThrow(UnauthorizedException);
      }
    });

    it('rejects forged tokens with altered signatures', async () => {
      const token = createJwtToken({ uid: 'usr-1', role: Role.CUSTOMER }, 'bad_secret');
      const { context } = createMockContext(`Bearer ${token}`);
      await expect(Promise.resolve().then(() => authGuard.canActivate(context))).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired JWT with 401 Unauthorized', async () => {
      const token = createJwtToken({ uid: 'usr-1', role: Role.CUSTOMER }, undefined, -30);
      const { context } = createMockContext(`Bearer ${token}`);
      await expect(Promise.resolve().then(() => authGuard.canActivate(context))).rejects.toThrow(UnauthorizedException);
    });

    it('accepts authentic signed JWT and populates request.user', async () => {
      const token = createJwtToken({
        uid: 'usr-1',
        role: Role.CUSTOMER,
        email: 'customer@kudicart.in',
        name: 'Ananya Sharma',
      });
      const { context, request } = createMockContext(`Bearer ${token}`);
      const allowed = authGuard.canActivate(context);
      expect(allowed).toBe(true);
      expect(request.user).toBeDefined();
      expect(request.user.id).toBe('usr-1');
      expect(request.user.role).toBe(Role.CUSTOMER);
    });
  });

  describe('4. Role-Based Access Control (RBAC)', () => {
    const createMockContext = (token: string, handlerRoles?: Role[]) => {
      const mockRequest: any = {
        headers: { authorization: `Bearer ${token}` },
        url: '/api/v1/admin/dashboard',
      };
      return {
        context: {
          switchToHttp: () => ({ getRequest: () => mockRequest }),
          getHandler: () => {},
          getClass: () => {},
        } as any,
        request: mockRequest,
      };
    };

    it('rejects Customer token on Admin-only routes with 403 Forbidden', () => {
      const customerToken = createJwtToken({ uid: 'usr-1', role: Role.CUSTOMER });
      const { context } = createMockContext(customerToken);

      // 1. AuthGuard accepts verified token
      authGuard.canActivate(context);
      // 2. RolesGuard checks Role.ADMIN
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rejects Driver token on Admin-only routes with 403 Forbidden', () => {
      const driverToken = createJwtToken({ uid: 'usr-driver-1', role: Role.DRIVER, driverId: 'drv-1' });
      const { context } = createMockContext(driverToken);

      authGuard.canActivate(context);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows Admin token on Admin routes', () => {
      const adminToken = createJwtToken({ uid: 'usr-admin-1', role: Role.ADMIN });
      const { context, request } = createMockContext(adminToken);

      authGuard.canActivate(context);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      expect(rolesGuard.canActivate(context)).toBe(true);
      expect(request.user.role).toBe(Role.ADMIN);
    });
  });

  describe('5. Customer Authentication Service', () => {
    it('sends OTP without exposing fixed mock OTP', async () => {
      const res = await authService.sendOtp('+91 98450 12890');
      expect(res.success).toBe(true);
      expect((res as any).mockOtpForTesting).toBeUndefined();
    });

    it('rejects invalid OTP attempts', async () => {
      await authService.sendOtp('+91 98450 12890');
      await expect(authService.verifyOtp('+91 98450 12890', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('verifies correct OTP and returns signed JWT with valid signature', async () => {
      await authService.sendOtp('+91 98450 12890');
      const testOtp = authService.getOtpForTesting('+91 98450 12890');
      expect(testOtp).toBeDefined();

      const res = await authService.verifyOtp('+91 98450 12890', testOtp!);
      expect(res.success).toBe(true);
      expect(res.token).toBeDefined();

      // Ensure token has valid cryptographic signature
      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.role).toBe(Role.CUSTOMER);
    });

    it('logs in via Firebase ID token and returns signed JWT', async () => {
      const testToken = 'test-firebase-id-token:fb-customer-42:+919845099999:user42@kudicart.in';
      const res = await authService.loginFirebase(testToken);
      expect(res.success).toBe(true);
      expect(res.token).toBeDefined();

      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.firebaseUid).toBe('fb-customer-42');
    });
  });

  describe('6. Driver Authentication Service', () => {
    it('verifies driver OTP and returns signed JWT with Role.DRIVER', async () => {
      const phone = '9876543210';
      await driverAuthService.sendOtp(phone);
      const testOtp = driverAuthService.getOtpForTesting(phone);
      expect(testOtp).toBeDefined();

      const res = await driverAuthService.verifyOtp(phone, testOtp!);
      expect(res.success).toBe(true);
      expect(res.role).toBe(Role.DRIVER);

      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.role).toBe(Role.DRIVER);
      expect(verified.payload.driverId).toBeDefined();
    });

    it('logs in driver via Firebase ID token and returns signed JWT with Role.DRIVER', async () => {
      const testToken = 'test-firebase-id-token:fb-drv-888:+919876543210:driver@kudicart.in';
      const res = await driverAuthService.loginFirebase(testToken);
      expect(res.success).toBe(true);
      expect(res.role).toBe(Role.DRIVER);

      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.role).toBe(Role.DRIVER);
      expect(verified.payload.driverId).toBeDefined();
    });
  });

  describe('7. Admin Authentication Service', () => {
    it('rejects invalid admin password with 401 Unauthorized', async () => {
      await expect(
        adminAuthService.login({
          email: 'amara@kudicart.com',
          password: 'WrongPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('authenticates valid admin and returns signed JWT with Role.ADMIN', async () => {
      const res = await adminAuthService.login({
        email: 'amara@kudicart.com',
        password: 'KudiCart#Admin2026!',
      });
      expect(res.success).toBe(true);
      expect(res.role).toBe(Role.ADMIN);

      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.role).toBe(Role.ADMIN);
    });

    it('rejects Firebase login for email without admin access with 403 Forbidden', async () => {
      const testToken = 'test-firebase-id-token:fb-random-user:+919999999999:unknown@gmail.com';
      await expect(adminAuthService.loginFirebase(testToken)).rejects.toThrow(ForbiddenException);
    });

    it('authenticates recognized admin via Firebase ID token', async () => {
      const testToken = 'test-firebase-id-token:fb-admin-user:+919999900000:amara@kudicart.com';
      const res = await adminAuthService.loginFirebase(testToken);
      expect(res.success).toBe(true);
      expect(res.role).toBe(Role.ADMIN);

      const verified = verifyJwtToken(res.token);
      expect(verified.valid).toBe(true);
      expect(verified.payload.role).toBe(Role.ADMIN);
    });
  });

  describe('8. Independent Production Readiness Verification & Gap Closure', () => {
    it('rejects tokens specifying alg: none (algorithm confusion defense)', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ uid: 'attacker', role: Role.ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const noneToken = `${header}.${payload}.`;
      const result = verifyJwtToken(noneToken);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Unsupported or prohibited JWT algorithm|Token signature missing/);
    });

    it('rejects tokens specifying alg: RS256 with HMAC secret (asymmetric/symmetric confusion)', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ uid: 'attacker', role: Role.ADMIN, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const rsToken = `${header}.${payload}.dummy_signature`;
      const result = verifyJwtToken(rsToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unsupported or prohibited JWT algorithm');
    });

    it('does not default driverId to drv-1 when driverId claim is absent from token', () => {
      const token = createJwtToken({ uid: 'usr-unassigned-driver', role: Role.DRIVER });
      const mockReq: any = { headers: { authorization: `Bearer ${token}` } };
      const mockCtx: any = {
        switchToHttp: () => ({ getRequest: () => mockReq }),
      };

      authGuard.canActivate(mockCtx);
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.role).toBe(Role.DRIVER);
      expect(mockReq.user.driverId).toBeUndefined();
    });

    it('rejects non-existent order query with 404 without fabricating fake orders', async () => {
      const ordersService = app.get<OrdersService>(OrdersService);
      await expect(
        ordersService.getOrderById('ord-fabricated-test-nonexistent', 'usr-1', Role.ADMIN),
      ).rejects.toThrow(Error);
    });

    it('FIFO dispatch fails safely when zero drivers are online/available', async () => {
      const dispatchService = app.get<DispatchService>(DispatchService);
      const store = prisma.getStore();

      // Temporarily mark all drivers offline
      const originalStates = store.drivers.map((d: any) => ({ id: d.id, isOnline: d.isOnline }));
      store.drivers.forEach((d: any) => { d.isOnline = false; });

      const testOrder = store.orders[0];
      testOrder.status = 'READY_FOR_PICKUP';

      const res = await dispatchService.dispatchOrderFifo(testOrder.id);
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/No delivery partners are currently available/);

      // Restore states
      originalStates.forEach((os: any) => {
        const d = store.drivers.find((dr: any) => dr.id === os.id);
        if (d) d.isOnline = os.isOnline;
      });
    });
  });
});
