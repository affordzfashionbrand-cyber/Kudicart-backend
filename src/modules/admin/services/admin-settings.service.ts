import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkspacePreferencesDto } from '../dto/admin-domain.dto';
import { UpdateAdminProfileDto } from '../dto/admin-actions.dto';

const DEFAULT_PREFERENCES = {
  defaultPageSize: 10,
  currencyStandard: 'INR (₹)',
  timestampFormat: 'IST',
  highDensityRows: false,
  audioAlertExceptions: true,
};

@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private async resolveAdminActor(userId: string) {
    const dbUser = await this.prisma.user.findFirst({
      where: {
        role: 'ADMIN',
        OR: [{ id: userId }, { email: userId }],
      },
    });

    const credsRow = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'adminCredentials' },
    });
    const creds = Array.isArray(credsRow?.value) ? (credsRow!.value as any[]) : [];
    const matchedCred =
      creds.find(
        (c) =>
          c.id === userId ||
          c.userId === userId ||
          (c.email && c.email.toLowerCase() === userId.toLowerCase()) ||
          (dbUser?.email && c.email?.toLowerCase() === dbUser.email.toLowerCase()),
      ) || creds[0];

    const resolvedDbUser =
      dbUser ||
      (matchedCred?.userId || matchedCred?.email
        ? await this.prisma.user.findFirst({
            where: {
              role: 'ADMIN',
              OR: [
                ...(matchedCred.userId ? [{ id: matchedCred.userId }] : []),
                ...(matchedCred.email ? [{ email: matchedCred.email }] : []),
              ],
            },
          })
        : null) ||
      (await this.prisma.user.findFirst({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
      }));

    if (!resolvedDbUser && !matchedCred) {
      throw new NotFoundException('Admin profile not found');
    }

    return { resolvedDbUser, matchedCred, creds };
  }

  async getProfileAndSession(userId: string) {
    this.ensureDb();

    const { resolvedDbUser, matchedCred } = await this.resolveAdminActor(userId);
    const roleLabel = matchedCred?.role || 'Super Admin';
    const staffId = matchedCred?.id || resolvedDbUser?.id || userId;
    const name = resolvedDbUser?.name || matchedCred?.name || 'Admin';
    const email = resolvedDbUser?.email || matchedCred?.email || '';

    const profile = {
      displayName: name,
      email,
      staffId,
      role: roleLabel,
      assignedTerminal: matchedCred?.assignedTerminal || 'Central Ops HQ',
      accessLevel:
        roleLabel === 'Super Admin' ? 'Full Authority' : 'Restricted Operational',
      assignedPermissions: 'Database-Verified RBAC',
      verified: true,
    };

    const activeSession = {
      channelStatus: 'Active & Encrypted (TLS 1.3)',
      authProvider: 'Firebase Authentication',
      timestamp: new Date().toISOString(),
    };

    return {
      profile,
      activeSession,
    };
  }

  async updateProfile(userId: string, dto: UpdateAdminProfileDto) {
    this.ensureDb();

    const { resolvedDbUser, matchedCred, creds } = await this.resolveAdminActor(userId);
    const normalizedEmail = dto.email ? dto.email.trim().toLowerCase() : undefined;

    let updatedUser = resolvedDbUser;
    if (resolvedDbUser) {
      updatedUser = await this.prisma.user.update({
        where: { id: resolvedDbUser.id },
        data: {
          ...(dto.displayName ? { name: dto.displayName.trim() } : {}),
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
        },
      });
    }

    if (matchedCred && Array.isArray(creds)) {
      const nextCreds = creds.map((c) =>
        c.id === matchedCred.id || c.userId === matchedCred.userId
          ? {
              ...c,
              ...(dto.displayName ? { name: dto.displayName.trim() } : {}),
              ...(normalizedEmail ? { email: normalizedEmail } : {}),
            }
          : c,
      );
      await this.prisma.workspaceSetting.upsert({
        where: { key: 'adminCredentials' },
        update: { value: nextCreds },
        create: { key: 'adminCredentials', value: nextCreds },
      });
    }

    return {
      success: true,
      message: 'Admin profile updated successfully',
      profile: {
        displayName: updatedUser?.name || dto.displayName || matchedCred?.name,
        email: updatedUser?.email || normalizedEmail || matchedCred?.email,
        staffId: matchedCred?.id || updatedUser?.id || userId,
        role: matchedCred?.role || 'Super Admin',
      },
    };
  }

  async getPreferences() {
    this.ensureDb();

    const row = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'workspacePreferences' },
    });
    const prefs = {
      ...DEFAULT_PREFERENCES,
      ...(row?.value && typeof row.value === 'object' ? (row.value as Record<string, any>) : {}),
    };

    return {
      ...prefs,
      data: prefs,
    };
  }

  async savePreferences(dto: WorkspacePreferencesDto) {
    this.ensureDb();

    const existing = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'workspacePreferences' },
    });
    const merged = {
      ...DEFAULT_PREFERENCES,
      ...(existing?.value && typeof existing.value === 'object'
        ? (existing.value as Record<string, any>)
        : {}),
      ...dto,
    };

    await this.prisma.workspaceSetting.upsert({
      where: { key: 'workspacePreferences' },
      update: { value: merged },
      create: { key: 'workspacePreferences', value: merged },
    });

    return {
      success: true,
      message: 'Workspace preferences updated successfully.',
      preferences: merged,
    };
  }
}

