import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { validateJwtSecret, getJwtSecret } from '../../common/utils/crypto.util';

describe('Phase 1 Security Hardening & Audit Verification', () => {
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    if (prisma) {
      await prisma.$disconnect();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('JWT Secret Security & Fail-Closed Validation', () => {
    it('fails closed in production if JWT_SECRET is unset', () => {
      process.env.APP_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => validateJwtSecret()).toThrow(
        /FATAL: JWT_SECRET environment variable is strictly required in production mode/,
      );
    });

    it('fails closed in production if NODE_ENV=production and JWT_SECRET is unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => validateJwtSecret()).toThrow(
        /FATAL: JWT_SECRET environment variable is strictly required in production mode/,
      );
    });

    it('fails closed in production if JWT_SECRET is shorter than 32 characters', () => {
      process.env.APP_ENV = 'production';
      process.env.JWT_SECRET = 'short_insecure_secret_123'; // 25 chars

      expect(() => validateJwtSecret()).toThrow(
        /FATAL: JWT_SECRET must be at least 32 characters in length in production mode/,
      );
    });

    it('fails closed in production if JWT_SECRET is a known insecure default', () => {
      process.env.APP_ENV = 'production';
      process.env.JWT_SECRET = 'affordz_dev_testing_only_jwt_secret_not_for_production';

      expect(() => validateJwtSecret()).toThrow(
        /FATAL: Insecure or default JWT_SECRET detected in production mode/,
      );
    });

    it('succeeds in production when provided a high-entropy 32+ character secret', () => {
      process.env.APP_ENV = 'production';
      const validSecret = 'a-very-long-production-grade-cryptographic-jwt-secret-2026!';
      process.env.JWT_SECRET = validSecret;

      expect(validateJwtSecret()).toBe(validSecret);
    });

    it('provides isolated test secret in test mode when unset', () => {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'test';
      delete process.env.APP_ENV;

      const secret = getJwtSecret();
      expect(secret).toBe('affordz_dev_testing_only_jwt_secret_not_for_production');
    });
  });

  describe('PostgreSQL Audit Persistence & Sanitization', () => {
    const createdAuditIds: string[] = [];

    afterEach(async () => {
      if (createdAuditIds.length > 0 && prisma.isConnectedToDb) {
        await prisma.auditLog.deleteMany({
          where: { id: { in: createdAuditIds } },
        });
        createdAuditIds.length = 0;
      }
    });

    it('persists audit events directly into PostgreSQL AuditLog table', async () => {
      if (!prisma.isConnectedToDb) {
        return; // Skip if db not available
      }

      const entityId = `test-entity-${Date.now()}`;
      const res = await prisma.recordAuditEvent({
        actorId: 'usr-admin-test',
        actorName: 'Audit Test Admin',
        actorRole: 'ADMIN',
        actionType: 'UPDATE_ORDER_STATUS',
        entityId,
        entityType: 'ORDER',
        summary: 'Order status updated to OUT_FOR_DELIVERY in test',
        changePayload: {
          previousStatus: 'READY_FOR_PICKUP',
          newStatus: 'OUT_FOR_DELIVERY',
        },
      });

      expect(res).toBeDefined();
      expect(res.id).toBeDefined();
      createdAuditIds.push(res.id);

      const saved = await prisma.auditLog.findUnique({
        where: { id: res.id },
      });

      expect(saved).not.toBeNull();
      expect(saved?.userId).toBe('usr-admin-test');
      expect(saved?.userEmail).toBe('Audit Test Admin');
      expect(saved?.action).toBe('UPDATE_ORDER_STATUS');
      expect(saved?.entityType).toBe('ORDER');
      expect(saved?.entityId).toBe(entityId);

      const parsedDetails = JSON.parse(saved?.details || '{}');
      expect(parsedDetails.summary).toBe('Order status updated to OUT_FOR_DELIVERY in test');
      expect(parsedDetails.changePayload.newStatus).toBe('OUT_FOR_DELIVERY');
    });

    it('strictly redacts sensitive credentials from audit changePayload', async () => {
      if (!prisma.isConnectedToDb) {
        return;
      }

      const entityId = `test-user-${Date.now()}`;
      const res = await prisma.recordAuditEvent({
        actorId: 'usr-admin-test',
        actorName: 'Security Admin',
        actorRole: 'ADMIN',
        actionType: 'UPDATE_USER_CREDENTIALS',
        entityId,
        entityType: 'USER',
        summary: 'User credentials updated',
        changePayload: {
          username: 'johndoe',
          password: 'SecretPassword123!',
          idToken: 'eyJhbGciOi...',
          otp: '582910',
          pin: '1234',
          nested: {
            creditCard: '4111222233334444',
            safeField: 'retained-data',
          },
        },
      });

      createdAuditIds.push(res.id);

      const saved = await prisma.auditLog.findUnique({
        where: { id: res.id },
      });

      const parsedDetails = JSON.parse(saved?.details || '{}');
      expect(parsedDetails.changePayload.username).toBe('johndoe');
      expect(parsedDetails.changePayload.password).toBe('[REDACTED]');
      expect(parsedDetails.changePayload.idToken).toBe('[REDACTED]');
      expect(parsedDetails.changePayload.otp).toBe('[REDACTED]');
      expect(parsedDetails.changePayload.pin).toBe('[REDACTED]');
      expect(parsedDetails.changePayload.nested.creditCard).toBe('[REDACTED]');
      expect(parsedDetails.changePayload.nested.safeField).toBe('retained-data');
    });
  });
});

