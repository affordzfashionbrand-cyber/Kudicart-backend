import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { verifyJwtToken } from '../utils/crypto.util';
import { FirebaseAdminService } from '../../modules/auth/firebase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header in Bearer token format is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header must be in Bearer token format');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

    // Fail closed against mock/debug tokens in production and runtime
    if (
      token.startsWith('mock-') ||
      token === 'test_token' ||
      token === 'driver' ||
      token === 'admin' ||
      token === 'vendor' ||
      token.length < 15
    ) {
      throw new UnauthorizedException('Mock authentication tokens are rejected');
    }

    // 1. Verify as a cryptographically signed Backend JWT (synchronous path)
    const jwtResult = verifyJwtToken(token);
    if (jwtResult.valid && jwtResult.payload) {
      const payload = jwtResult.payload;
      const uid = payload.uid || payload.sub;
      if (!uid) {
        throw new UnauthorizedException('Token payload missing subject identifier');
      }

      this.resolveAndSetUser(request, {
        uid,
        firebaseUid: payload.firebaseUid || uid,
        phone: payload.phone_number || payload.phone,
        email: payload.email,
        name: payload.name || 'User',
        role: (payload.role as Role) || Role.CUSTOMER,
        driverId: payload.role === Role.DRIVER ? (payload.driverId || undefined) : undefined,
        vendorId: payload.role === Role.VENDOR ? (payload.vendorId || undefined) : undefined,
      });

      return true;
    }

    // If explicit expiration failure, fail immediately
    if (jwtResult.error === 'Token has expired') {
      throw new UnauthorizedException('Authentication token has expired');
    }

    // 2. Verify as a Firebase ID Token (asynchronous path)
    if (this.firebaseAdmin) {
      return this.verifyFirebaseToken(request, token);
    }

    // Token failed signature verification and no Firebase verification available
    throw new UnauthorizedException(jwtResult.error || 'Invalid or malformed authentication token');
  }

  private async verifyFirebaseToken(request: any, token: string): Promise<boolean> {
    const decoded = await this.firebaseAdmin!.verifyIdToken(token);
    const uid = decoded.uid;

    let role: Role = Role.CUSTOMER;
    let driverId: string | undefined;
    let vendorId: string | undefined;

    // Check database / store for role and driver/vendor mappings
    if (this.prisma && this.prisma.getStore) {
      const store = this.prisma.getStore();
      const foundUser = store.users?.find(
        (u: any) => u.firebaseUid === uid || u.id === uid,
      );
      if (foundUser) {
        role = foundUser.role as Role;
        if (role === Role.DRIVER) {
          const drv = store.drivers?.find(
            (d: any) => d.userId === foundUser.id || d.id === foundUser.id,
          );
          driverId = drv?.id;
        } else if (role === Role.VENDOR) {
          const vend = store.vendors?.find(
            (v: any) => v.userId === foundUser.id || v.id === foundUser.id,
          );
          vendorId = vend?.id;
        }
      }
    }

    this.resolveAndSetUser(request, {
      uid,
      firebaseUid: uid,
      phone: decoded.phoneNumber,
      email: decoded.email,
      name: decoded.name || 'Customer',
      role,
      driverId,
      vendorId,
    });

    return true;
  }

  private resolveAndSetUser(
    request: any,
    claims: {
      uid: string;
      firebaseUid: string;
      phone?: string;
      email?: string;
      name?: string;
      role: Role;
      driverId?: string;
      vendorId?: string;
    },
  ) {
    let userRecord: any = null;

    if (this.prisma && this.prisma.getStore) {
      const store = this.prisma.getStore();
      userRecord = store.users?.find(
        (u: any) => u.id === claims.uid || u.firebaseUid === claims.firebaseUid,
      );

      // Check admin users if role is ADMIN
      if (!userRecord && claims.role === Role.ADMIN && store.adminUsers) {
        const adminUser = store.adminUsers.find(
          (a: any) =>
            a.id === claims.uid ||
            a.userId === claims.uid ||
            (claims.email && a.email.toLowerCase() === claims.email.toLowerCase()),
        );
        if (adminUser) {
          userRecord = {
            id: adminUser.userId || adminUser.id,
            firebaseUid: adminUser.firebaseUid || adminUser.id,
            email: adminUser.email,
            name: adminUser.name,
            role: Role.ADMIN,
            status: adminUser.status || 'ACTIVE',
          };
        }
      }

      // Check driver record if role is DRIVER
      if (claims.role === Role.DRIVER && store.drivers) {
        const drv = store.drivers.find(
          (d: any) =>
            d.id === claims.driverId ||
            d.userId === claims.uid ||
            d.id === claims.uid ||
            (claims.phone && d.phone?.includes(claims.phone)),
        );
        if (drv) {
          claims.driverId = drv.id;
        }
      }

      if (userRecord && userRecord.status === 'SUSPENDED') {
        throw new ForbiddenException('User account has been suspended');
      }
    }

    const resolvedUser: AuthenticatedUser = {
      id: userRecord?.id || claims.uid,
      firebaseUid: userRecord?.firebaseUid || claims.firebaseUid,
      phone: userRecord?.phone || claims.phone,
      email: userRecord?.email || claims.email,
      name: userRecord?.name || claims.name || 'Authenticated User',
      avatar: userRecord?.avatar,
      role: userRecord?.role || claims.role,
      driverId: claims.driverId,
      vendorId: claims.vendorId,
    };

    request.user = resolvedUser;
  }
}

