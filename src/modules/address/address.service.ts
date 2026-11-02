import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AddressService {
  private readonly logger = new Logger(AddressService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  private async resolveCanonicalUserId(userId: string, currentUser?: AuthenticatedUser): Promise<string> {
    if (currentUser) {
      const user = await this.usersService.resolveCanonicalUser(currentUser);
      return user.id;
    }
    return userId;
  }

  async getAddresses(userId: string, currentUser?: AuthenticatedUser) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    if (this.prisma.isConnectedToDb) {
      try {
        const addresses = await this.prisma.address.findMany({
          where: { userId: canonicalUserId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
        return addresses;
      } catch (err: any) {
        this.logger.error(`Database getAddresses failed: ${err.message}`, err.stack);
      }
    }

    const store = this.prisma.getStore();
    return store.addresses
      .filter((a) => a.userId === canonicalUserId)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  }

  async getAddressById(userId: string, id: string, currentUser?: AuthenticatedUser) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    if (this.prisma.isConnectedToDb) {
      try {
        const address = await this.prisma.address.findFirst({
          where: { id, userId: canonicalUserId },
        });
        if (!address) {
          throw new NotFoundException(`Address with ID "${id}" not found.`);
        }
        return address;
      } catch (err: any) {
        if (err instanceof NotFoundException) throw err;
        this.logger.error(`Database getAddressById failed: ${err.message}`, err.stack);
      }
    }

    const address = this.prisma.getStore().addresses.find(
      (a) => a.id === id && a.userId === canonicalUserId,
    );
    if (!address) {
      throw new NotFoundException(`Address with ID "${id}" not found.`);
    }
    return address;
  }

  async addAddress(userId: string, dto: CreateAddressDto, currentUser?: AuthenticatedUser) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    if (this.prisma.isConnectedToDb) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const count = await tx.address.count({ where: { userId: canonicalUserId } });
          const isDefault = dto.isDefault ?? (count === 0);

          if (isDefault) {
            await tx.address.updateMany({
              where: { userId: canonicalUserId },
              data: { isDefault: false },
            });
          }

          const newAddress = await tx.address.create({
            data: {
              id: `addr-${randomUUID().slice(0, 8)}`,
              userId: canonicalUserId,
              label: dto.label.trim(),
              recipientName: dto.recipientName?.trim() || null,
              recipientPhone: dto.recipientPhone?.trim() || null,
              line1: dto.line1.trim(),
              line2: dto.line2?.trim() || null,
              locality: dto.locality.trim(),
              city: dto.city.trim(),
              state: dto.state?.trim() || null,
              pincode: dto.pincode.trim(),
              latitude: dto.latitude ?? null,
              longitude: dto.longitude ?? null,
              isDefault,
            },
          });

          this.syncStoreAddress(newAddress);
          return newAddress;
        });
      } catch (err: any) {
        this.logger.error(`Database addAddress failed: ${err.message}`, err.stack);
        throw err;
      }
    }

    // In-memory store fallback
    const store = this.prisma.getStore();
    const userAddresses = store.addresses.filter((a) => a.userId === canonicalUserId);
    const isDefault = dto.isDefault ?? (userAddresses.length === 0);

    if (isDefault) {
      userAddresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    const newAddress = {
      id: `addr-${randomUUID().slice(0, 8)}`,
      userId: canonicalUserId,
      label: dto.label.trim(),
      recipientName: dto.recipientName?.trim() || null,
      recipientPhone: dto.recipientPhone?.trim() || null,
      line1: dto.line1.trim(),
      line2: dto.line2?.trim() || null,
      locality: dto.locality.trim(),
      city: dto.city.trim(),
      state: dto.state?.trim() || null,
      pincode: dto.pincode.trim(),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      isDefault,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.addresses.push(newAddress);
    return newAddress;
  }

  async updateAddress(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
    currentUser?: AuthenticatedUser,
  ) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);
    await this.getAddressById(canonicalUserId, id);

    if (this.prisma.isConnectedToDb) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (dto.isDefault === true) {
            await tx.address.updateMany({
              where: { userId: canonicalUserId, id: { not: id } },
              data: { isDefault: false },
            });
          }

          const updateData: any = {};
          if (dto.label !== undefined) updateData.label = dto.label.trim();
          if (dto.recipientName !== undefined) updateData.recipientName = dto.recipientName.trim() || null;
          if (dto.recipientPhone !== undefined) updateData.recipientPhone = dto.recipientPhone.trim() || null;
          if (dto.line1 !== undefined) updateData.line1 = dto.line1.trim();
          if (dto.line2 !== undefined) updateData.line2 = dto.line2.trim() || null;
          if (dto.locality !== undefined) updateData.locality = dto.locality.trim();
          if (dto.city !== undefined) updateData.city = dto.city.trim();
          if (dto.state !== undefined) updateData.state = dto.state.trim() || null;
          if (dto.pincode !== undefined) updateData.pincode = dto.pincode.trim();
          if (dto.latitude !== undefined) updateData.latitude = dto.latitude;
          if (dto.longitude !== undefined) updateData.longitude = dto.longitude;
          if (dto.isDefault !== undefined) updateData.isDefault = dto.isDefault;

          const updated = await tx.address.update({
            where: { id },
            data: updateData,
          });

          this.syncStoreAddress(updated);
          return updated;
        });
      } catch (err: any) {
        this.logger.error(`Database updateAddress failed: ${err.message}`, err.stack);
        throw err;
      }
    }

    // In-memory store fallback
    const store = this.prisma.getStore();
    const address = store.addresses.find((a) => a.id === id && a.userId === canonicalUserId);
    if (!address) throw new NotFoundException(`Address with ID "${id}" not found.`);

    if (dto.isDefault === true) {
      store.addresses
        .filter((a) => a.userId === canonicalUserId)
        .forEach((a) => {
          a.isDefault = a.id === id;
        });
    }

    if (dto.label !== undefined) address.label = dto.label.trim();
    if (dto.recipientName !== undefined) (address as any).recipientName = dto.recipientName.trim() || null;
    if (dto.recipientPhone !== undefined) (address as any).recipientPhone = dto.recipientPhone.trim() || null;
    if (dto.line1 !== undefined) address.line1 = dto.line1.trim();
    if (dto.line2 !== undefined) (address as any).line2 = dto.line2.trim() || null;
    if (dto.locality !== undefined) address.locality = dto.locality.trim();
    if (dto.city !== undefined) address.city = dto.city.trim();
    if (dto.state !== undefined) (address as any).state = dto.state.trim() || null;
    if (dto.pincode !== undefined) (address as any).pincode = dto.pincode.trim();
    if (dto.latitude !== undefined) (address as any).latitude = dto.latitude;
    if (dto.longitude !== undefined) (address as any).longitude = dto.longitude;
    if (dto.isDefault !== undefined) address.isDefault = dto.isDefault;
    (address as any).updatedAt = new Date().toISOString();

    return address;
  }

  async setDefaultAddress(userId: string, id: string, currentUser?: AuthenticatedUser) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);
    await this.getAddressById(canonicalUserId, id);

    if (this.prisma.isConnectedToDb) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.address.updateMany({
            where: { userId: canonicalUserId, id: { not: id } },
            data: { isDefault: false },
          });

          const updated = await tx.address.update({
            where: { id },
            data: { isDefault: true },
          });

          this.syncStoreAddress(updated);
          return updated;
        });
      } catch (err: any) {
        this.logger.error(`Database setDefaultAddress failed: ${err.message}`, err.stack);
        throw err;
      }
    }

    const store = this.prisma.getStore();
    store.addresses
      .filter((a) => a.userId === canonicalUserId)
      .forEach((a) => {
        a.isDefault = a.id === id;
      });

    return store.addresses.find((a) => a.id === id);
  }

  async deleteAddress(userId: string, id: string, currentUser?: AuthenticatedUser) {
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);
    const existing = await this.getAddressById(canonicalUserId, id);

    if (this.prisma.isConnectedToDb) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.address.delete({ where: { id } });

          // If the deleted address was the default address, promote the most recently updated remaining address
          if (existing.isDefault) {
            const remaining = await tx.address.findFirst({
              where: { userId: canonicalUserId },
              orderBy: { updatedAt: 'desc' },
            });
            if (remaining) {
              await tx.address.update({
                where: { id: remaining.id },
                data: { isDefault: true },
              });
            }
          }

          this.removeStoreAddress(id);
          return { success: true, message: `Address ${id} deleted successfully` };
        });
      } catch (err: any) {
        this.logger.error(`Database deleteAddress failed: ${err.message}`, err.stack);
        throw err;
      }
    }

    const store = this.prisma.getStore();
    const index = store.addresses.findIndex((a) => a.id === id && a.userId === canonicalUserId);
    if (index === -1) {
      throw new NotFoundException(`Address with ID "${id}" not found.`);
    }

    const wasDefault = store.addresses[index].isDefault;
    store.addresses.splice(index, 1);

    if (wasDefault) {
      const remaining = store.addresses.filter((a) => a.userId === canonicalUserId);
      if (remaining.length > 0) {
        remaining[remaining.length - 1].isDefault = true;
      }
    }

    return { success: true, message: `Address ${id} deleted successfully` };
  }

  private syncStoreAddress(addr: any) {
    const store = this.prisma.getStore();
    const idx = store.addresses.findIndex((a) => a.id === addr.id);
    const serialized = {
      id: addr.id,
      userId: addr.userId,
      label: addr.label,
      recipientName: addr.recipientName || null,
      recipientPhone: addr.recipientPhone || null,
      line1: addr.line1,
      line2: addr.line2 || null,
      locality: addr.locality,
      city: addr.city,
      state: addr.state || null,
      pincode: addr.pincode,
      isDefault: addr.isDefault,
      createdAt: addr.createdAt instanceof Date ? addr.createdAt.toISOString() : addr.createdAt,
      updatedAt: addr.updatedAt instanceof Date ? addr.updatedAt.toISOString() : addr.updatedAt,
    };
    if (idx !== -1) {
      store.addresses[idx] = serialized;
    } else {
      store.addresses.push(serialized);
    }
  }

  private removeStoreAddress(id: string) {
    const store = this.prisma.getStore();
    const idx = store.addresses.findIndex((a) => a.id === id);
    if (idx !== -1) {
      store.addresses.splice(idx, 1);
    }
  }
}
