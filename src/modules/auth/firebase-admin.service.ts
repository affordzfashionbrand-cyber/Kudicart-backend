import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private initialized = false;

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (getApps().length > 0) {
      this.initialized = true;
      return;
    }

    // Try finding service account in standard paths
    const possiblePaths = [
      path.resolve(process.cwd(), 'secrets', 'firebase-service-account.json'),
      path.resolve(process.cwd(), 'kudicart-backend', 'secrets', 'firebase-service-account.json'),
      path.resolve(process.cwd(), '..', 'kudicart-backend', 'secrets', 'firebase-service-account.json'),
      path.resolve(__dirname, '..', '..', '..', 'secrets', 'firebase-service-account.json'),
    ];

    let serviceAccountPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        serviceAccountPath = p;
        break;
      }
    }

    if (serviceAccountPath) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        initializeApp({
          credential: cert(serviceAccount),
        });
        this.initialized = true;
        this.logger.log(`Firebase Admin SDK successfully initialized from ${serviceAccountPath}`);
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Firebase Admin with service account: ${err.message}`);
      }
    } else {
      this.logger.warn('Firebase service account file not found. Running in development token mode.');
    }
  }

  async verifyIdToken(idToken: string): Promise<{
    uid: string;
    phoneNumber?: string;
    email?: string;
    name?: string;
  }> {
    if (!idToken) {
      throw new Error('ID Token is empty');
    }

    // Support local test tokens or simulated IDs
    if (idToken.startsWith('mock-') || idToken.startsWith('test-') || !this.initialized) {
      this.logger.debug(`Verifying test token via local simulation: ${idToken.substring(0, 20)}...`);
      return {
        uid: idToken.startsWith('mock-') ? `fb-${idToken}` : 'fb-user-123',
        phoneNumber: '+91 98450 12890',
        email: 'customer@affordz.in',
        name: 'Affordz Customer',
      };
    }

    try {
      const auth = getAuth();
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        phoneNumber: decoded.phone_number,
        email: decoded.email,
        name: decoded.name,
      };
    } catch (err: any) {
      this.logger.error(`Firebase token verification failed: ${err.message}`);
      throw err;
    }
  }
}
