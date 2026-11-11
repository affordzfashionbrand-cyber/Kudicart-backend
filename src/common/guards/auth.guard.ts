import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { verifyJwtToken } from '../utils/crypto.util';
import { buildPhoneLookupCandidates } from '../utils/phone.util';
import { FirebaseAdminService } from '../../modules/auth/firebase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authorization header in Bearer token format is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header must be in Bearer token format');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

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

    const jwtResult = verifyJwtToken(token);
    if (jwtResult.valid && jwtResult.payload) {
      const payload = jwtResult.payload;
      const userId = payload.sub || payload.uid;
      if (!userId) {
        throw new UnauthorizedException('Token payload missing subject identifier');
      }

      return this.resolveAndSetUser(request, userId, payload.email, payload.role, {
        name: payload.name || payload.displayName,
        phone: payload.phone,
        role: (payload.role as Role) || Role.CUSTOMER,
        driverId: payload.role === Role.DRIVER ? payload.driverId || undefined : undefined,
        vendorId: payload.role === Role.VENDOR ? payload.vendorId || undefined : undefined,
        adminRole: payload.adminRole || undefined,
      });
    }

    if (jwtResult.error === 'Token has expired') {
      throw new UnauthorizedException('Authentication token has expired');
    }

    if (this.firebaseAdmin) {
      return this.verifyFirebaseToken(request, token);
    }

    throw new UnauthorizedException(jwtResult.error || 'Invalid or malformed authentication token');
  }

  private async verifyFirebaseToken(request: any, token: string): Promise<boolean> {
    try {
      const decoded = await this.firebaseAdmin!.verifyIdToken(token);
      if (!decoded || !decoded.uid) {
        throw new UnauthorizedException('Invalid Firebase ID token');
      }

      let role: Role = Role.CUSTOMER;
      let userId = decoded.uid;
      let name = decoded.name || 'Affordz User';
      let email = decoded.email;
      let phone = decoded.phoneNumber;
      let driverId: string | undefined;
      let vendorId: string | undefined;

      if (this.prisma) {
        if (!this.prisma.isConnectedToDb) {
          throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
        }
        const phoneCandidates = buildPhoneLookupCandidates(decoded.phoneNumber);
        const orClauses: any[] = [{ firebaseUid: decoded.uid }];
        if (decoded.email) {
          orClauses.push({ email: decoded.email.toLowerCase() });
        }
        if (phoneCandidates.length > 0) {
          orClauses.push(...phoneCandidates.map((p) => ({ phone: p })));
        }

        const dbUser = await this.prisma.user.findFirst({
          where: { OR: orClauses },
          include: { driverProfile: true, vendor: true },
        });
        if (dbUser) {
          if (dbUser.status !== 'ACTIVE') {
            throw new ForbiddenException('Account is inactive or suspended');
          }
          userId = dbUser.id;
          role = dbUser.role as Role;
          name = dbUser.name;
          email = dbUser.email || email;
          phone = dbUser.phone || phone;
          driverId = dbUser.driverProfile?.id;
          vendorId = dbUser.vendor?.id;
        }
      }

      request.user = {
        id: userId,
        firebaseUid: decoded.uid,
        role,
        name,
        email,
        phone,
        driverId,
        vendorId,
      } as AuthenticatedUser;

      return true;
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired Firebase authentication token');
    }
  }

  private async resolveAndSetUser(
    request: any,
    userId: string,
    email: string | undefined,
    _role: string | undefined,
    claims: Partial<AuthenticatedUser>,
  ): Promise<boolean> {
    let resolvedUser: AuthenticatedUser = {
      id: userId,
      role: (claims.role as Role) || Role.CUSTOMER,
      name: claims.name || 'Affordz User',
      email: email || claims.email,
      phone: claims.phone,
      driverId: claims.driverId,
      vendorId: claims.vendorId,
      adminRole: claims.adminRole,
    };

    if (this.prisma) {
      if (!this.prisma.isConnectedToDb) {
        throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
      }

      let userRecord = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { driverProfile: true, vendor: true },
      });

      if (!userRecord && email) {
        userRecord = await this.prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: { driverProfile: true, vendor: true },
        });
      }

      if (!userRecord) {
        throw new UnauthorizedException('User account no longer exists');
      }

      if (userRecord.status !== 'ACTIVE') {
        throw new ForbiddenException('User account is not active');
      }

      resolvedUser = {
        id: userRecord.id,
        firebaseUid: userRecord.firebaseUid || undefined,
        role: (userRecord.role as Role) || Role.CUSTOMER,
        name: userRecord.name || claims.name || 'Affordz User',
        email: userRecord.email || email,
        phone: userRecord.phone || claims.phone,
        driverId:
          userRecord.role === Role.DRIVER && userRecord.driverProfile
            ? userRecord.driverProfile.id
            : claims.driverId,
        vendorId:
          userRecord.role === Role.VENDOR && userRecord.vendor
            ? userRecord.vendor.id
            : claims.vendorId,
        adminRole: claims.adminRole,
      };
    }

    request.user = resolvedUser;
    return true;
  }
}
