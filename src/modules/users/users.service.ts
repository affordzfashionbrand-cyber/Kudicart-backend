import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Resolves or creates the canonical user record backed by PostgreSQL.
   * Guarantees distinct internal database ID from Firebase UID and idempotent lookup.
   */
  async resolveCanonicalUser(currentUser: AuthenticatedUser) {
    if (this.prisma.isConnectedToDb) {
      try {
        // 1. Primary lookup by verified Firebase UID
        if (currentUser.firebaseUid) {
          const userByFirebaseUid = await this.prisma.user.findFirst({
            where: { firebaseUid: currentUser.firebaseUid },
          });
          if (userByFirebaseUid) {
            this.syncStoreUser(userByFirebaseUid);
            return userByFirebaseUid;
          }
        }

        // 2. Secondary lookup by verified phone number if available
        if (currentUser.phone) {
          const userByPhone = await this.prisma.user.findFirst({
            where: { phone: currentUser.phone },
          });
          if (userByPhone) {
            // Bind the verified Firebase UID if not already bound
            if (currentUser.firebaseUid && userByPhone.firebaseUid !== currentUser.firebaseUid) {
              const updated = await this.prisma.user.update({
                where: { id: userByPhone.id },
                data: { firebaseUid: currentUser.firebaseUid },
              });
              this.syncStoreUser(updated);
              return updated;
            }
            this.syncStoreUser(userByPhone);
            return userByPhone;
          }
        }

        // 3. Tertiary lookup by internal ID
        if (currentUser.id) {
          const userById = await this.prisma.user.findUnique({
            where: { id: currentUser.id },
          });
          if (userById) {
            this.syncStoreUser(userById);
            return userById;
          }
        }

        // 4. Idempotently create new customer record in PostgreSQL
        const newDbUser = await this.prisma.user.create({
          data: {
            id: `usr-${randomUUID().slice(0, 8)}`,
            firebaseUid: currentUser.firebaseUid || `fb-${randomUUID().slice(0, 8)}`,
            phone: currentUser.phone || '',
            email: currentUser.email || null,
            name: currentUser.name || 'KudiCart Customer',
            avatar: currentUser.avatar || null,
            role: (currentUser.role as any) || 'CUSTOMER',
            status: 'ACTIVE',
          },
        });
        this.syncStoreUser(newDbUser);
        return newDbUser;
      } catch (err: any) {
        this.logger.error(`Database user resolution error: ${err.message}`, err.stack);
        // Fall back to in-memory store if DB query fails unexpectedly
      }
    }

    // In-Memory store resolution (for offline dev/test)
    const store = this.prisma.getStore();
    let user = store.users.find(
      (u) =>
        (currentUser.firebaseUid && u.firebaseUid === currentUser.firebaseUid) ||
        (currentUser.id && u.id === currentUser.id) ||
        (currentUser.phone && u.phone === currentUser.phone),
    );

    if (!user) {
      const newUserRecord: any = {
        id: currentUser.id && currentUser.id.startsWith('usr-') ? currentUser.id : `usr-${randomUUID().slice(0, 8)}`,
        firebaseUid: currentUser.firebaseUid || `fb-${randomUUID().slice(0, 8)}`,
        phone: currentUser.phone || '',
        email: currentUser.email || null,
        name: currentUser.name || 'KudiCart Customer',
        avatar: currentUser.avatar || null,
        role: (currentUser.role as any) || 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
      store.users.push(newUserRecord);
      user = newUserRecord;
    }

    return user;
  }

  async getProfile(userId: string, currentUser?: AuthenticatedUser) {
    let user: any;
    if (currentUser) {
      user = await this.resolveCanonicalUser(currentUser);
    } else {
      if (this.prisma.isConnectedToDb) {
        user = await this.prisma.user.findUnique({ where: { id: userId } });
      }
      if (!user) {
        user = this.prisma.getStore().users.find((u) => u.id === userId);
      }
    }

    if (!user) {
      throw new NotFoundException(`User record "${userId}" not found.`);
    }

    return {
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      status: (user as any).status || 'ACTIVE',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateUserDto, currentUser?: AuthenticatedUser) {
    const user = currentUser ? await this.resolveCanonicalUser(currentUser) : await this.getProfile(userId);
    if (!user) {
      throw new NotFoundException(`User record "${userId}" not found.`);
    }

    if ((user as any).status === 'SUSPENDED') {
      throw new ForbiddenException('Account is suspended. Profile updates are not permitted.');
    }

    const updateData: { name?: string; email?: string | null; avatar?: string } = {};

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Name cannot be empty.');
      }
      updateData.name = trimmed;
    }

    if (dto.email !== undefined) {
      const trimmed = dto.email.trim();
      updateData.email = trimmed ? trimmed.toLowerCase() : null;
    }

    if (dto.avatar !== undefined) {
      updateData.avatar = dto.avatar;
    }

    if (this.prisma.isConnectedToDb) {
      try {
        const updated = await this.prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        this.syncStoreUser(updated);
        return {
          id: updated.id,
          firebaseUid: updated.firebaseUid,
          phone: updated.phone,
          email: updated.email,
          name: updated.name,
          avatar: updated.avatar,
          role: updated.role,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      } catch (err: any) {
        if (err.code === 'P2002') {
          throw new BadRequestException('This email address is already linked to another account.');
        }
        this.logger.error(`Failed to persist user profile update: ${err.message}`, err.stack);
        throw new BadRequestException(`Failed to update profile: ${err.message}`);
      }
    }

    // In-memory store fallback
    const store = this.prisma.getStore();
    const stored = store.users.find((u) => u.id === user.id);
    if (stored) {
      if (updateData.name !== undefined) stored.name = updateData.name;
      if (updateData.email !== undefined) stored.email = updateData.email;
      if (updateData.avatar !== undefined) stored.avatar = updateData.avatar;
      (stored as any).updatedAt = new Date().toISOString();
      return stored;
    }

    return user;
  }

  private syncStoreUser(user: any) {
    const store = this.prisma.getStore();
    const idx = store.users.findIndex((u) => u.id === user.id || u.firebaseUid === user.firebaseUid);
    const serialized = {
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      status: user.status || 'ACTIVE',
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
      updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    };
    if (idx !== -1) {
      store.users[idx] = { ...store.users[idx], ...serialized };
    } else {
      store.users.push(serialized);
    }
  }
}
