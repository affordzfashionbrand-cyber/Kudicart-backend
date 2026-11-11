import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveCanonicalUserId(
    userId: string,
    currentUser?: AuthenticatedUser,
  ): Promise<string> {
    this.ensureDbConnected();

    if (currentUser) {
      const user = await this.usersService.resolveCanonicalUser(currentUser);
      return user.id;
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userId }, { firebaseUid: userId }],
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`User '${userId}' not found.`);
    }

    return existing.id;
  }

  async getAddresses(userId: string, currentUser?: AuthenticatedUser) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    return this.prisma.address.findMany({
      where: { userId: canonicalUserId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async getAddressById(userId: string, id: string, currentUser?: AuthenticatedUser) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    const address = await this.prisma.address.findFirst({
      where: { id, userId: canonicalUserId },
    });

    if (!address) {
      throw new NotFoundException(`Address '${id}' not found.`);
    }

    return address;
  }

  async addAddress(
    userId: string,
    dto: CreateAddressDto,
    currentUser?: AuthenticatedUser,
  ) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    return this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.address.count({
        where: { userId: canonicalUserId },
      });

      const shouldBeDefault = dto.isDefault === true || existingCount === 0;
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId: canonicalUserId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
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
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async updateAddress(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
    currentUser?: AuthenticatedUser,
  ) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    const existing = await this.prisma.address.findFirst({
      where: { id, userId: canonicalUserId },
    });

    if (!existing) {
      throw new NotFoundException(`Address '${id}' not found.`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.address.updateMany({
          where: { userId: canonicalUserId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          label: dto.label !== undefined ? dto.label.trim() : existing.label,
          recipientName:
            dto.recipientName !== undefined
              ? dto.recipientName?.trim() || null
              : existing.recipientName,
          recipientPhone:
            dto.recipientPhone !== undefined
              ? dto.recipientPhone?.trim() || null
              : existing.recipientPhone,
          line1: dto.line1 !== undefined ? dto.line1.trim() : existing.line1,
          line2:
            dto.line2 !== undefined ? dto.line2?.trim() || null : existing.line2,
          locality: dto.locality !== undefined ? dto.locality.trim() : existing.locality,
          city: dto.city !== undefined ? dto.city.trim() : existing.city,
          state:
            dto.state !== undefined ? dto.state?.trim() || null : existing.state,
          pincode: dto.pincode !== undefined ? dto.pincode.trim() : existing.pincode,
          latitude: dto.latitude !== undefined ? dto.latitude : existing.latitude,
          longitude: dto.longitude !== undefined ? dto.longitude : existing.longitude,
          isDefault: dto.isDefault !== undefined ? dto.isDefault : existing.isDefault,
        },
      });
    });
  }

  async setDefaultAddress(
    userId: string,
    id: string,
    currentUser?: AuthenticatedUser,
  ) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    const existing = await this.prisma.address.findFirst({
      where: { id, userId: canonicalUserId },
    });

    if (!existing) {
      throw new NotFoundException(`Address '${id}' not found.`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId: canonicalUserId, isDefault: true },
        data: { isDefault: false },
      });

      return tx.address.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }

  async deleteAddress(userId: string, id: string, currentUser?: AuthenticatedUser) {
    this.ensureDbConnected();
    const canonicalUserId = await this.resolveCanonicalUserId(userId, currentUser);

    const existing = await this.prisma.address.findFirst({
      where: { id, userId: canonicalUserId },
    });

    if (!existing) {
      throw new NotFoundException(`Address '${id}' not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });

      if (existing.isDefault) {
        const replacement = await tx.address.findFirst({
          where: { userId: canonicalUserId },
          orderBy: { updatedAt: 'desc' },
        });
        if (replacement) {
          await tx.address.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return { success: true, deletedId: id };
  }
}
