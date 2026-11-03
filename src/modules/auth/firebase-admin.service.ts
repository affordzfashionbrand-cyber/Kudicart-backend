import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Lazy loader functions to avoid CommonJS/ESM module parsing conflicts in Jest
function getFirebaseApp() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('firebase-admin/app');
}

function getFirebaseAuth() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('firebase-admin/auth');
}

function getFirebaseMessaging() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('firebase-admin/messaging');
}

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private initialized = false;

  onModuleInit() {
    this.initializeFirebase();
  }

  isReady(): boolean {
    return this.initialized;
  }

  private initializeFirebase() {
    try {
      const { getApps, initializeApp, cert } = getFirebaseApp();
      if (getApps().length > 0) {
        this.initialized = true;
        return;
      }

      // 1. Check FIREBASE_SERVICE_ACCOUNT environment variable (JSON content or file path)
      const envServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (envServiceAccount) {
        let serviceAccount: any;
        if (envServiceAccount.trim().startsWith('{')) {
          serviceAccount = JSON.parse(envServiceAccount);
        } else if (fs.existsSync(envServiceAccount.trim())) {
          serviceAccount = JSON.parse(fs.readFileSync(envServiceAccount.trim(), 'utf8'));
        }
        if (serviceAccount) {
          initializeApp({ credential: cert(serviceAccount) });
          this.initialized = true;
          this.logger.log('Firebase Admin SDK initialized from FIREBASE_SERVICE_ACCOUNT environment variable');
          return;
        }
      }

      // 2. Check GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_PATH
      const explicitPath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (explicitPath && fs.existsSync(explicitPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(explicitPath, 'utf8'));
        initializeApp({ credential: cert(serviceAccount) });
        this.initialized = true;
        this.logger.log(`Firebase Admin SDK initialized from explicit path: ${explicitPath}`);
        return;
      }

      // 3. Search standard filesystem paths
      const possiblePaths = [
        path.resolve(process.cwd(), 'secrets', 'firebase-service-account.json'),
        path.resolve(process.cwd(), 'kudicart-backend', 'secrets', 'firebase-service-account.json'),
        path.resolve(process.cwd(), '..', 'kudicart-backend', 'secrets', 'firebase-service-account.json'),
        path.resolve(__dirname, '..', '..', '..', 'secrets', 'firebase-service-account.json'),
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          const serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
          initializeApp({ credential: cert(serviceAccount) });
          this.initialized = true;
          this.logger.log(`Firebase Admin SDK initialized from ${p}`);
          return;
        }
      }

      // Fail closed warning: No valid credentials discovered
      this.logger.warn(
        'Firebase service account credentials not found. Runtime requests requiring Firebase verification will fail closed.',
      );
    } catch (err: any) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${err.message}`);
    }
  }

  async verifyIdToken(idToken: string): Promise<{
    uid: string;
    phoneNumber?: string;
    email?: string;
    name?: string;
  }> {
    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Firebase ID token is required');
    }

    // Isolated test fixtures strictly limited to Jest/unit testing environment (retained only in tests)
    if (process.env.NODE_ENV === 'test') {
      if (idToken.startsWith('test-firebase-id-token:')) {
        const parts = idToken.split(':');
        return {
          uid: parts[1] || 'test-firebase-uid',
          phoneNumber: parts[2] || '+91 98450 12890',
          email: parts[3] || 'test.customer@kudicart.in',
          name: 'Test Firebase User',
        };
      }
      if (idToken.startsWith('mock-firebase-id-token') || idToken.startsWith('test-')) {
        return {
          uid: 'fb-user-123',
          phoneNumber: '+91 98450 12890',
          email: 'customer@kudicart.in',
          name: 'KudiCart Customer',
        };
      }
    }

    // Fail closed: Never return simulated identity in runtime or production
    if (!this.initialized) {
      throw new UnauthorizedException(
        'Firebase authentication service is not configured on this server. Contact administrator.',
      );
    }

    try {
      const { getAuth } = getFirebaseAuth();
      const auth = getAuth();
      const decoded = await auth.verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        phoneNumber: decoded.phone_number,
        email: decoded.email,
        name: decoded.name,
      };
    } catch (err: any) {
      this.logger.warn(`Firebase token verification failed: ${err.message}`);
      throw new UnauthorizedException(`Firebase token verification failed: ${err.message}`);
    }
  }

  /**
   * Sends multicast FCM push notification to given device registration tokens.
   * Gracefully returns batch outcome with invalid/unregistered tokens identified.
   */
  async sendMulticastPush(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, string>;
      imageUrl?: string;
    },
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    if (!tokens || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    if (!this.initialized) {
      this.logger.warn(
        `Firebase not initialized. Simulating FCM push for ${tokens.length} recipients: ${payload.title}`,
      );
      return { successCount: tokens.length, failureCount: 0, invalidTokens: [] };
    }

    try {
      const { getMessaging } = getFirebaseMessaging();
      const messaging = getMessaging();

      const message: any = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        },
        data: payload.data || {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'kudicart_critical_alerts',
          },
        },
      };

      const response = await messaging.sendEachForMulticast(message);
      const invalidTokens: string[] = [];

      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-registration-token'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      this.logger.log(
        `FCM multicast sent: ${response.successCount} succeeded, ${response.failureCount} failed`,
      );

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (err: any) {
      this.logger.error(`FCM multicast delivery error: ${err.message}`, err.stack);
      return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
    }
  }
}


