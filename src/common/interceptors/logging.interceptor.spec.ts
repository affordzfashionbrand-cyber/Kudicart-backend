import { LoggingInterceptor } from './logging.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
  });

  describe('Sanitization & Masking Logic (Checklist Item 8)', () => {
    it('redacts password, token, cvv, and secret keys in objects', () => {
      const payload = {
        email: 'user@example.com',
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        cvv: '999',
        cardNumber: '4111 2222 3333 4444',
        nested: {
          webhookSecret: 'whsec_test_secret',
          otp: '742900',
          normalField: 'safeValue',
        },
      };

      const sanitized = interceptor.sanitize(payload);

      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.cvv).toBe('[REDACTED]');
      expect(sanitized.cardNumber).toBe('[REDACTED]');
      expect(sanitized.nested.webhookSecret).toBe('[REDACTED]');
      expect(sanitized.nested.otp).toBe('[REDACTED]');
      expect(sanitized.nested.normalField).toBe('safeValue');
    });

    it('masks phone numbers and email addresses in strings', () => {
      const text = 'Customer phone is 9845012890 and email is contact@kudicart.in';
      const sanitized = interceptor.sanitize(text);

      expect(sanitized).toContain('98450*****');
      expect(sanitized).not.toContain('9845012890');
      expect(sanitized).toContain('@kudicart.in');
      expect(sanitized).not.toContain('contact@kudicart.in');
    });

    it('redacts raw credit card sequences in text', () => {
      const text = 'Payment with card 4111-2222-3333-4444 completed';
      const sanitized = interceptor.sanitize(text);

      expect(sanitized).toContain('****-****-****-[REDACTED]');
      expect(sanitized).not.toContain('4111-2222-3333-4444');
    });

    it('handles arrays and primitives safely without mutations', () => {
      const arrayData = [
        { password: '123', name: 'Alice' },
        { token: 'abc', name: 'Bob' },
      ];

      const sanitized = interceptor.sanitize(arrayData);

      expect(sanitized[0].password).toBe('[REDACTED]');
      expect(sanitized[0].name).toBe('Alice');
      expect(sanitized[1].token).toBe('[REDACTED]');
      expect(sanitized[1].name).toBe('Bob');
    });
  });

  describe('Interceptor Pipeline', () => {
    it('executes next handler and logs request/response without throwing', (done) => {
      const mockRequest = {
        method: 'POST',
        url: '/api/v1/auth/phone/send-otp',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        body: { phoneNumber: '+91 98450 12890', otp: '123456' },
      };

      const mockResponse = {
        statusCode: 200,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => of({ success: true, message: 'OTP sent' }),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (res) => {
          expect(res.success).toBe(true);
          done();
        },
      });
    });

    it('intercepts errors, logs warning, and rethrows to exception filter', (done) => {
      const mockRequest = {
        method: 'GET',
        url: '/api/v1/orders/ord-999',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => ({ statusCode: 404 }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => throwError(() => new Error('Order not found')),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        error: (err) => {
          expect(err.message).toBe('Order not found');
          done();
        },
      });
    });
  });
});
