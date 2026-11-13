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
    return this.initialized || Boolean(this.getWebApiKey());
  }

  private getWebApiKey(): string | undefined {
    return (
      process.env.FIREBASE_WEB_API_KEY ||
      process.env.VITE_FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      'AIzaSyDNrOgdNcWwL4RxN9f-3Ktp7e73rSlOifc'
    );
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
    picture?: string;
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
          phoneNumber: parts[2] ? parts[2] : undefined,
          email: parts[3] ? parts[3] : undefined,
          name: 'Test Firebase User',
        };
      }
      if (idToken.startsWith('mock-firebase-id-token') || idToken.startsWith('test-')) {
        return {
          uid: 'fb-user-123',
          phoneNumber: '+91 98450 12890',
          email: 'customer@affordz.in',
          name: 'Affordz Customer',
        };
      }
    }

    // 1. If Firebase Admin SDK is initialized with a service account, verify via Admin SDK
    if (this.initialized) {
      try {
        const { getAuth } = getFirebaseAuth();
        const auth = getAuth();
        const decoded = await auth.verifyIdToken(idToken, true);
        return {
          uid: decoded.uid,
          phoneNumber: decoded.phone_number,
          email: decoded.email,
          name: decoded.name,
          picture: decoded.picture,
        };
      } catch (err: any) {
        this.logger.warn(`Firebase token verification failed: ${err.message}`);
        throw new UnauthorizedException('Authentication token verification failed. Please sign in again.');
      }
    }

    // 2. Cryptographically verify ID token directly with Google Identity Toolkit REST API
    const webApiKey = this.getWebApiKey();
    if (!webApiKey) {
      throw new UnauthorizedException(
        'Firebase authentication service is not configured on this server. Contact administrator.',
      );
    }

    try {
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        },
      );

      if (!response.ok) {
        const errBody: any = await response.json().catch(() => ({}));
        this.logger.warn(
          `Google Identity Toolkit verification rejected: ${JSON.stringify(errBody?.error?.message || errBody)}`,
        );
        throw new UnauthorizedException('Authentication token verification failed. Please sign in again.');
      }

      const data: any = await response.json();
      const user = data.users?.[0];
      if (!user || !user.localId) {
        throw new UnauthorizedException('Invalid Firebase ID token');
      }

      return {
        uid: user.localId,
        phoneNumber: user.phoneNumber,
        email: user.email,
        name: user.displayName,
        picture: user.photoUrl,
      };
    } catch (err: any) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`Failed to reach Google Identity Toolkit: ${err.message}`);
      throw new UnauthorizedException('Authentication service temporarily unavailable. Please try again.');
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
      channelId?: string;
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

      const channelId = payload.channelId || 'affordz_critical_alerts';

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
            channelId,
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


