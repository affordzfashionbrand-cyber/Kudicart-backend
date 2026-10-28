import { Controller, Post, Get, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('api/v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body.email || 'admin@kudicart.in';
    // Validate email
    if (email !== 'admin@kudicart.in' && !email.includes('admin')) {
      throw new UnauthorizedException('Invalid administrative credentials');
    }

    return {
      success: true,
      token: 'admin_session_token_' + Date.now(),
      user: {
        id: 'usr-admin-1',
        email: email,
        name: 'Operations Admin',
        role: 'ADMIN',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      },
    };
  }

  @Get('me')
  async getProfile() {
    return {
      id: 'usr-admin-1',
      email: 'admin@kudicart.in',
      name: 'Operations Admin',
      role: 'ADMIN',
      permissions: await this.adminService.getUserPermissions(),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    return { success: true, message: 'Logged out successfully' };
  }
}
