import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import {
  CreateAdminUserDto,
  UpdateAdminUserRoleDto,
  UpdateRolePermissionsDto,
} from '../dto/admin-domain.dto';
import { hashPassword } from '../../../common/utils/crypto.util';

@Injectable()
export class AdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private async getAdminCredentials(): Promise<any[]> {
    const row = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'adminCredentials' },
    });
    return Array.isArray(row?.value) ? [...(row!.value as any[])] : [];
  }

  private async saveAdminCredentials(creds: any[]) {
    await this.prisma.workspaceSetting.upsert({
      where: { key: 'adminCredentials' },
      update: { value: creds },
      create: { key: 'adminCredentials', value: creds },
    });
  }

  private async getRolePermissionsSetting(): Promise<{ roles: any[]; permissions: Record<string, any> }> {
    const row = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'rolePermissions' },
    });
    const val = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<string, any>;
    const roles = Array.isArray(val.roles) ? [...val.roles] : [];
    const permissions =
      val.permissions && typeof val.permissions === 'object'
        ? { ...val.permissions }
        : !Array.isArray(val.roles)
          ? { ...val }
          : {};
    return { roles, permissions };
  }

  private async saveRolePermissionsSetting(data: { roles: any[]; permissions: Record<string, any> }) {
    await this.prisma.workspaceSetting.upsert({
      where: { key: 'rolePermissions' },
      update: { value: data },
      create: { key: 'rolePermissions', value: data },
    });
  }

  async listUsers(query: AdminQueryDto) {
    this.ensureDb();

    const [creds, dbAdmins] = await Promise.all([
      this.getAdminCredentials(),
      this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const byEmail = new Map<string, any>();
    for (const c of creds) {
      if (c?.email) byEmail.set(String(c.email).toLowerCase(), { ...c });
    }
    for (const u of dbAdmins) {
      const key = u.email ? u.email.toLowerCase() : u.id;
      if (!byEmail.has(key)) {
        byEmail.set(key, {
          id: u.id,
          userId: u.id,
          name: u.name,
          email: u.email,
          role: 'Central Admin',
          status: u.status,
          lastActive: u.updatedAt.toISOString(),
          department: 'Marketplace Operations',
          avatarInitials: (u.name || 'AD')
            .split(' ')
            .filter(Boolean)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase(),
          assignedTerminal: 'Central Ops HQ',
          createdAt: u.createdAt.toISOString(),
        });
      }
    }

    let users = Array.from(byEmail.values());

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      users = users.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.role || '').toLowerCase().includes(q),
      );
    }

    if (query.role && query.role !== 'ALL') {
      users = users.filter((u) => u.role === query.role);
    }

    if (query.status && query.status !== 'ALL') {
      users = users.filter((u) => u.status === query.status);
    }

    const safeUsers = users.map(({ passwordHash, ...u }) => u);

    return {
      data: safeUsers,
      total: safeUsers.length,
    };
  }

  async inviteUser(
    dto: CreateAdminUserDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const cleanEmail = dto.email.trim().toLowerCase();
    const [creds, existingDbUser, roleSettings] = await Promise.all([
      this.getAdminCredentials(),
      this.prisma.user.findUnique({ where: { email: cleanEmail } }),
      this.getRolePermissionsSetting(),
    ]);

    const existingCred = creds.find(
      (u) => (u.email || '').toLowerCase() === cleanEmail,
    );
    if (existingCred || existingDbUser) {
      throw new BadRequestException(
        `An admin account with email '${cleanEmail}' already exists.`,
      );
    }

    const defaultHash = hashPassword('Affordz#Admin2026!');
    const initials = dto.name
      .split(' ')
      .filter(Boolean)
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const adminId = `ADM-${(creds.length + 1).toString().padStart(3, '0')}`;
    const createdUser = await this.prisma.user.create({
      data: {
        firebaseUid: `fb-admin-${adminId.toLowerCase()}-${randomUUID().slice(0, 6)}`,
        name: dto.name.trim(),
        email: cleanEmail,
        role: 'ADMIN',
        status: (dto.status as any) || 'ACTIVE',
      },
    });

    const newUser = {
      id: adminId,
      userId: createdUser.id,
      name: createdUser.name,
      email: cleanEmail,
      passwordHash: defaultHash,
      role: dto.role,
      status: dto.status || 'ACTIVE',
      lastActive: 'Just invited',
      department: dto.department || 'Marketplace Operations',
      avatarInitials: initials || 'AD',
      assignedTerminal: dto.assignedTerminal || 'Central Ops HQ',
      createdAt: createdUser.createdAt.toISOString(),
    };

    creds.push(newUser);
    await this.saveAdminCredentials(creds);

    const nextRoles = roleSettings.roles.map((r) =>
      r.name === dto.role
        ? { ...r, assignedUsersCount: (r.assignedUsersCount || 0) + 1 }
        : r,
    );
    await this.saveRolePermissionsSetting({
      roles: nextRoles,
      permissions: roleSettings.permissions,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || 'ADMIN',
        userEmail: actorName || null,
        userRole: 'ADMIN',
        action: 'ADMIN_INVITED',
        entityType: 'User',
        entityId: newUser.id,
        details: JSON.stringify({
          id: newUser.id,
          userId: newUser.userId,
          email: newUser.email,
          role: newUser.role,
          department: newUser.department,
        }),
      },
    });

    const { passwordHash, ...safeUser } = newUser;
    return {
      success: true,
      message: `Administrative user ${newUser.name} invited successfully.`,
      user: safeUser,
    };
  }

  async updateUserRole(
    id: string,
    dto: UpdateAdminUserRoleDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const creds = await this.getAdminCredentials();
    const index = creds.findIndex((u) => u.id === id || u.userId === id);

    let dbUser = await this.prisma.user.findFirst({
      where: {
        role: 'ADMIN',
        OR: [
          { id },
          ...(index >= 0 && creds[index].userId ? [{ id: creds[index].userId }] : []),
          ...(index >= 0 && creds[index].email ? [{ email: creds[index].email }] : []),
        ],
      },
    });

    if (index === -1 && !dbUser) {
      throw new NotFoundException(`Administrative user account '${id}' was not found.`);
    }

    const existing = index >= 0 ? { ...creds[index] } : null;
    const previousRole = existing?.role || 'Central Admin';
    const previousStatus = existing?.status || dbUser?.status || 'ACTIVE';

    if (dbUser && dto.status) {
      dbUser = await this.prisma.user.update({
        where: { id: dbUser.id },
        data: { status: dto.status as any },
      });
    }

    const updatedRecord = existing
      ? {
          ...existing,
          ...(dto.role ? { role: dto.role } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        }
      : {
          id: dbUser!.id,
          userId: dbUser!.id,
          name: dbUser!.name,
          email: dbUser!.email,
          role: dto.role || 'Central Admin',
          status: dto.status || dbUser!.status,
        };

    if (index >= 0) {
      creds[index] = updatedRecord;
      await this.saveAdminCredentials(creds);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || 'ADMIN',
        userEmail: actorName || null,
        userRole: 'ADMIN',
        action: 'ROLE_ASSIGNMENT_CHANGED',
        entityType: 'User',
        entityId: updatedRecord.id,
        details: JSON.stringify({
          userId: updatedRecord.id,
          previousRole,
          newRole: updatedRecord.role,
          previousStatus,
          newStatus: updatedRecord.status,
        }),
      },
    });

    const { passwordHash, ...safeUser } = updatedRecord;
    return {
      success: true,
      message: `Access configuration for ${updatedRecord.name} updated successfully.`,
      user: safeUser,
    };
  }

  async listRoles() {
    this.ensureDb();
    const { roles } = await this.getRolePermissionsSetting();
    return {
      data: roles,
    };
  }

  async getRolePermissions() {
    this.ensureDb();
    const { permissions } = await this.getRolePermissionsSetting();
    return {
      data: permissions,
    };
  }

  async updateRolePermissions(
    dto: UpdateRolePermissionsDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const setting = await this.getRolePermissionsSetting();
    setting.permissions[dto.roleId] = dto.permissions;
    await this.saveRolePermissionsSetting(setting);

    await this.prisma.auditLog.create({
      data: {
        userId: actorId || 'ADMIN',
        userEmail: actorName || null,
        userRole: 'ADMIN',
        action: 'ROLE_PERMISSIONS_UPDATED',
        entityType: 'User',
        entityId: dto.roleId,
        details: JSON.stringify({
          roleId: dto.roleId,
          moduleCount: Object.keys(dto.permissions || {}).length,
        }),
      },
    });

    return {
      success: true,
      message: `Permissions updated successfully for role '${dto.roleId}'.`,
      permissions: dto.permissions,
    };
  }
}

