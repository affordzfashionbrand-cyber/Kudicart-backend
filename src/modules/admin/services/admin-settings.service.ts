import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkspacePreferencesDto } from '../dto/admin-domain.dto';
import { UpdateAdminProfileDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminSettingsService {
  constructor(private prisma: PrismaService) {}

  async getProfileAndSession(userId: string) {
    const store = this.prisma.getStore();
    const admin =
      (store.adminUsers || []).find(
        (u: any) => u.userId === userId || u.id === userId || u.email === userId,
      ) || store.adminUsers[0];

    const profile = {
      displayName: admin.name,
      email: admin.email,
      staffId: admin.id,
      role: admin.role,
      assignedTerminal: admin.assignedTerminal || 'Central Ops HQ',
      accessLevel: admin.role === 'Super Admin' ? 'Full Authority' : 'Restricted Operational',
      assignedPermissions: '17/17 Modules Authorized',
      verified: true,
    };

    const activeSession = {
      gatewayIp: '192.168.1.104',
      networkName: 'MUM-OPS-HQ-SECURE',
      sessionInitiated: 'Today, 08:30 IST',
      expiresIn: '22h 15m remaining',
      clientDevice: 'Admin Web Portal (Chrome / macOS)',
      channelStatus: 'Active & Encrypted (TLS 1.3)',
    };

    return {
      profile,
      activeSession,
    };
  }

  async updateProfile(userId: string, dto: UpdateAdminProfileDto) {
    const store = this.prisma.getStore();
    const admin =
      (store.adminUsers || []).find(
        (u: any) => u.userId === userId || u.id === userId,
      ) || store.adminUsers[0];

    if (dto.displayName) admin.name = dto.displayName;
    if (dto.email) admin.email = dto.email.trim().toLowerCase();

    return {
      success: true,
      message: 'Admin profile updated successfully',
      profile: {
        displayName: admin.name,
        email: admin.email,
        staffId: admin.id,
        role: admin.role,
      },
    };
  }

  async getPreferences() {
    const store = this.prisma.getStore();
    return {
      data: store.workspacePreferences || {
        defaultPageSize: 10,
        currencyStandard: 'INR (₹)',
        timestampFormat: 'IST',
        highDensityRows: false,
        audioAlertExceptions: true,
      },
    };
  }

  async savePreferences(dto: WorkspacePreferencesDto) {
    const store = this.prisma.getStore();
    store.workspacePreferences = {
      ...(store.workspacePreferences || {}),
      ...dto,
    };

    return {
      success: true,
      message: 'Workspace preferences updated successfully.',
      preferences: store.workspacePreferences,
    };
  }
}

