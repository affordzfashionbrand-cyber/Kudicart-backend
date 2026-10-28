import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
  constructor(private prisma: PrismaService) {}

  async listUsers(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let users = store.adminUsers || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      users = users.filter(
        (u: any) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q),
      );
    }

    if (query.role && query.role !== 'ALL') {
      users = users.filter((u: any) => u.role === query.role);
    }

    if (query.status && query.status !== 'ALL') {
      users = users.filter((u: any) => u.status === query.status);
    }

    // Exclude passwordHash from client responses
    const safeUsers = users.map(({ passwordHash, ...u }: any) => u);

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
    const store = this.prisma.getStore();
    const cleanEmail = dto.email.trim().toLowerCase();

    const existing = (store.adminUsers || []).find(
      (u: any) => u.email.toLowerCase() === cleanEmail,
    );
    if (existing) {
      throw new BadRequestException(`An admin account with email '${cleanEmail}' already exists.`);
    }

    const defaultHash = hashPassword('KudiCart#Admin2026!');
    const initials = dto.name
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const newUser = {
      id: `ADM-${(store.adminUsers.length + 1).toString().padStart(3, '0')}`,
      userId: `usr-admin-${Date.now()}`,
      name: dto.name.trim(),
      email: cleanEmail,
      passwordHash: defaultHash,
      role: dto.role,
      status: dto.status || 'ACTIVE',
      lastActive: 'Just invited',
      department: dto.department || 'Marketplace Operations',
      avatarInitials: initials,
      assignedTerminal: dto.assignedTerminal || 'Central Ops HQ',
      createdAt: new Date().toISOString(),
    };

    store.adminUsers.push(newUser);

    // Update role assigned count
    const roleDef = (store.adminRoles || []).find((r: any) => r.name === dto.role);
    if (roleDef) {
      roleDef.assignedUsersCount = (roleDef.assignedUsersCount || 0) + 1;
    }

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'ADMIN_INVITED' as any,
      entityId: newUser.id,
      entityName: newUser.name,
      entityType: 'User' as any,
      summary: `Invited new administrative user ${newUser.name} with role '${newUser.role}'`,
      targetDescription: `IAM Account Directory`,
      changePayload: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department,
      },
      entityLink: `/admin/user-access`,
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
    const store = this.prisma.getStore();
    const user = (store.adminUsers || []).find(
      (u: any) => u.id === id || u.userId === id,
    );

    if (!user) {
      throw new NotFoundException(`Administrative user account '${id}' was not found.`);
    }

    const previousRole = user.role;
    const previousStatus = user.status;

    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'ROLE_ASSIGNMENT_CHANGED' as any,
      entityId: user.id,
      entityName: user.name,
      entityType: 'User' as any,
      summary: `Administrative access updated for ${user.name}: Role (${previousRole} -> ${user.role}), Status (${previousStatus} -> ${user.status})`,
      targetDescription: `Administrative Account #${user.id}`,
      changePayload: {
        userId: user.id,
        previousRole,
        newRole: user.role,
        previousStatus,
        newStatus: user.status,
      },
      entityLink: `/admin/user-access`,
    });

    const { passwordHash, ...safeUser } = user;
    return {
      success: true,
      message: `Access configuration for ${user.name} updated successfully.`,
      user: safeUser,
    };
  }

  async listRoles() {
    const store = this.prisma.getStore();
    return {
      data: store.adminRoles || [],
    };
  }

  async getRolePermissions() {
    const store = this.prisma.getStore();
    return {
      data: store.rolePermissions || {},
    };
  }

  async updateRolePermissions(
    dto: UpdateRolePermissionsDto,
    actorId?: string,
    actorName?: string,
  ) {
    const store = this.prisma.getStore();
    if (!store.rolePermissions) store.rolePermissions = {};

    store.rolePermissions[dto.roleId] = dto.permissions;

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'ROLE_PERMISSIONS_UPDATED' as any,
      entityId: dto.roleId,
      entityName: dto.roleId,
      entityType: 'User' as any,
      summary: `Permissions matrix updated for role '${dto.roleId}'`,
      targetDescription: `Role Security Specification`,
      changePayload: {
        roleId: dto.roleId,
        moduleCount: Object.keys(dto.permissions).length,
      },
      entityLink: `/admin/user-access`,
    });

    return {
      success: true,
      message: `Permissions updated successfully for role '${dto.roleId}'.`,
      permissions: dto.permissions,
    };
  }
}

