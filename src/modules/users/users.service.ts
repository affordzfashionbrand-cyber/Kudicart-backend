import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string, currentUser?: AuthenticatedUser) {
    const store = this.prisma.getStore();
    let user = store.users.find((u) => u.id === userId);

    if (!user && currentUser?.phone) {
      user = store.users.find((u) => u.phone === currentUser.phone);
    }

    if (!user) {
      // Auto-hydrate user in persistent in-memory store so profile and orders bind cleanly
      user = {
        id: userId,
        firebaseUid: currentUser?.firebaseUid || `fb-${userId}`,
        phone: currentUser?.phone || '+91 8124188999',
        email: currentUser?.email || `customer.${userId.slice(-4)}@affordz.in`,
        name: currentUser?.name || 'Affordz Customer',
        avatar: currentUser?.avatar || null,
        role: (currentUser?.role as any) || 'CUSTOMER',
        createdAt: new Date().toISOString(),
      };
      store.users.push(user);
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto, currentUser?: AuthenticatedUser) {
    const user = await this.getProfile(userId, currentUser);
    if (dto.name !== undefined && dto.name.trim()) user.name = dto.name.trim();
    if (dto.email !== undefined) user.email = dto.email.trim();
    if (dto.avatar !== undefined) user.avatar = dto.avatar;
    return user;
  }
}
