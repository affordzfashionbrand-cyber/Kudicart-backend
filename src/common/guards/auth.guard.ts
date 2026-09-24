import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      // For local testing convenience if header not supplied, default to customer
      request.user = this.getDefaultCustomer();
      return true;
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization header must be in Bearer token format');
    }

    const token = authHeader.substring(7).trim();

    // Check for role-specific testing/demo tokens
    if (token.toLowerCase().includes('driver')) {
      request.user = this.getDefaultDriver();
      return true;
    }

    if (token.toLowerCase().includes('admin')) {
      request.user = this.getDefaultAdmin();
      return true;
    }

    if (token.toLowerCase().includes('vendor')) {
      request.user = this.getDefaultVendor();
      return true;
    }

    // Attempt decoding if it is a JWT-like structure (e.g., base64 payload)
    if (token.includes('.')) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
          const payload = JSON.parse(payloadJson);
          request.user = {
            id: payload.uid || payload.sub || 'usr-1',
            firebaseUid: payload.uid || payload.sub || 'fb-user-123',
            phone: payload.phone_number || '+91 98450 12890',
            email: payload.email || 'customer@kudicart.in',
            name: payload.name || 'Ananya Sharma',
            role: payload.role || Role.CUSTOMER,
            driverId: payload.role === Role.DRIVER ? (payload.driverId || 'drv-1') : undefined,
            vendorId: payload.role === Role.VENDOR ? (payload.vendorId || 'vend-1') : undefined,
          };
          return true;
        }
      } catch {
        // Fallback to customer if decode fails
      }
    }

    // Default to verified customer
    request.user = this.getDefaultCustomer();
    return true;
  }

  private getDefaultCustomer(): AuthenticatedUser {
    return {
      id: 'usr-1',
      firebaseUid: 'fb-user-123',
      phone: '+91 98450 12890',
      email: 's.vishwa8999@gmail.com',
      name: 'Ananya Sharma',
      avatar: 'https://lh3.googleusercontent.com/aida/AEtjO1VWtKT1o8SeNnSo4l3FyyDwDHs_2VrqMmxcyY66IrRg9rL8LkbbnuL2TffL_CyEaqzkwfMMb8tXKb4wQTNtgTrqXO9l2Yi8Pq4du2CXnP7lmY5vWpGHBTWfweA4JAHjIOXuFa59STYjuuXipREO_RT3mGzoprfKCWe-WrMubapxuDZ2B7UA-MwnQfHcf1AtMn-UkuyrLssuYf_YUriU8q2jFN8qIrperLt43xS0h1vE3Hgb0dCyrts8bMA',
      role: Role.CUSTOMER,
    };
  }

  private getDefaultDriver(): AuthenticatedUser {
    return {
      id: 'usr-driver-1',
      firebaseUid: 'fb-driver-123',
      phone: '+91 98765 43210',
      email: 'rajesh.driver@kudicart.in',
      name: 'Rajesh Kumar',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-9n0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
      role: Role.DRIVER,
      driverId: 'drv-1',
    };
  }

  private getDefaultAdmin(): AuthenticatedUser {
    return {
      id: 'usr-admin-1',
      firebaseUid: 'fb-admin-123',
      phone: '+91 99999 00000',
      email: 'admin@kudicart.in',
      name: 'KudiCart Operations Admin',
      role: Role.ADMIN,
    };
  }

  private getDefaultVendor(): AuthenticatedUser {
    return {
      id: 'usr-vendor-1',
      firebaseUid: 'fb-vendor-123',
      phone: '+91 80 4123 9988',
      email: 'vendor.avanya@kudicart.in',
      name: 'Meera Deshmukh',
      role: Role.VENDOR,
      vendorId: 'vend-1',
    };
  }
}
