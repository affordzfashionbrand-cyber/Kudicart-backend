import { Injectable, Logger, OnModuleInit, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
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

  isInitialized(): boolean {
    return this.initialized;
  }

  isReady(): boolean {
    return this.initialized || Boolean(this.getWebApiKey());
  }

  private isProductionRuntime(): boolean {
    const appEnv = (process.env.APP_ENV || '').toLowerCase();
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    return appEnv === 'production' || (nodeEnv === 'production' && appEnv !== 'development' && appEnv !== 'test');
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
      const rawExplicitPath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (rawExplicitPath) {
        const cleanPath = rawExplicitPath.replace(/^["']|["']$/g, '').trim();
        const candidatePaths = [
          cleanPath,
          path.resolve(cleanPath),
          path.resolve(process.cwd(), cleanPath),
          path.resolve(process.cwd(), 'kudicart-backend', cleanPath),
          path.resolve(__dirname, '..', '..', '..', cleanPath),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            const serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
            initializeApp({ credential: cert(serviceAccount) });
            this.initialized = true;
            this.logger.log(`Firebase Admin SDK initialized from explicit path: ${p}`);
            return;
          }
        }
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
      if (this.isProductionRuntime()) {
        this.logger.error(
          `Firebase Admin SDK is not initialized in production. Cannot dispatch FCM push to ${tokens.length} recipients.`,
        );
        return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
      }
      this.logger.warn(
        `Firebase not initialized in non-production runtime. Skipping live FCM push for ${tokens.length} recipients: ${payload.title}`,
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

  async getUserByEmail(email: string): Promise<string | null> {
    if (!this.initialized) return null;
    try {
      const { getAuth } = getFirebaseAuth();
      const userRecord = await getAuth().getUserByEmail(email);
      return userRecord.uid;
    } catch (err: any) {
      return null;
    }
  }

  async createAuthUser(params: {
    email: string;
    password: string;
    displayName: string;
    phoneNumber?: string;
  }): Promise<{ uid: string }> {
    if (!this.initialized) {
      this.logger.error(`Firebase Admin SDK is not initialized when attempting to create auth user for ${params.email}`);
      throw new ServiceUnavailableException('Firebase authentication service is not initialized on this server.');
    }
    const { getAuth } = getFirebaseAuth();
    const auth = getAuth();
    try {
      const userRecord = await auth.createUser({
        email: params.email,
        password: params.password,
        displayName: params.displayName,
        ...(params.phoneNumber ? { phoneNumber: params.phoneNumber } : {}),
      });
      await auth.setCustomUserClaims(userRecord.uid, { role: 'VENDOR' });
      return { uid: userRecord.uid };
    } catch (err: any) {
      if (err.code === 'auth/phone-number-already-exists' && params.phoneNumber) {
        this.logger.warn(
          `Phone number ${params.phoneNumber} already registered on Firebase. Retrying user creation with email only for ${params.email}.`,
        );
        const retryRecord = await auth.createUser({
          email: params.email,
          password: params.password,
          displayName: params.displayName,
        });
        await auth.setCustomUserClaims(retryRecord.uid, { role: 'VENDOR' });
        return { uid: retryRecord.uid };
      }
      this.logger.error(`Firebase Admin createUser failed for ${params.email}: ${err.message} (code: ${err.code})`);
      throw err;
    }
  }

  async setUserPassword(uid: string, password: string): Promise<void> {
    if (!this.initialized) return;
    const { getAuth } = getFirebaseAuth();
    await getAuth().updateUser(uid, { password });
  }

  async setUserClaims(uid: string, claims: Record<string, any>): Promise<void> {
    if (!this.initialized) return;
    const { getAuth } = getFirebaseAuth();
    await getAuth().setCustomUserClaims(uid, claims);
  }
}


