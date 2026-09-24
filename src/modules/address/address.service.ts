import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(private prisma: PrismaService) {}

  async getAddresses(userId: string) {
    return this.prisma.getStore().addresses.filter((a) => a.userId === userId);
  }

  async getAddressById(userId: string, id: string) {
    const address = this.prisma.getStore().addresses.find(
      (a) => a.id === id && a.userId === userId,
    );
    if (!address) {
      throw new NotFoundException(`Address with ID ${id} not found`);
    }
    return address;
  }

  async addAddress(userId: string, dto: CreateAddressDto) {
    const store = this.prisma.getStore();

    if (dto.isDefault) {
      store.addresses
        .filter((a) => a.userId === userId)
        .forEach((a) => {
          a.isDefault = false;
        });
    }

    const newAddress = {
      id: `addr-${Date.now()}`,
      userId,
      label: dto.label,
      line1: dto.line1,
      locality: dto.locality,
      city: dto.city,
      pincode: dto.pincode || '560038',
      isDefault: dto.isDefault ?? store.addresses.filter((a) => a.userId === userId).length === 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.addresses.push(newAddress);
    return newAddress;
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    const address = await this.getAddressById(userId, id);
    const store = this.prisma.getStore();

    if (dto.isDefault) {
      store.addresses
        .filter((a) => a.userId === userId)
        .forEach((a) => {
          a.isDefault = false;
        });
    }

    if (dto.label !== undefined) address.label = dto.label;
    if (dto.line1 !== undefined) address.line1 = dto.line1;
    if (dto.locality !== undefined) address.locality = dto.locality;
    if (dto.city !== undefined) address.city = dto.city;
    if (dto.pincode !== undefined) (address as any).pincode = dto.pincode;
    if (dto.isDefault !== undefined) address.isDefault = dto.isDefault;
    (address as any).updatedAt = new Date().toISOString();

    return address;
  }

  async setDefaultAddress(userId: string, id: string) {
    const address = await this.getAddressById(userId, id);
    const store = this.prisma.getStore();

    store.addresses
      .filter((a) => a.userId === userId)
      .forEach((a) => {
        a.isDefault = a.id === id;
      });

    return address;
  }

  async deleteAddress(userId: string, id: string) {
    const store = this.prisma.getStore();
    const index = store.addresses.findIndex((a) => a.id === id && a.userId === userId);

    if (index === -1) {
      throw new NotFoundException(`Address with ID ${id} not found`);
    }

    store.addresses.splice(index, 1);
    return { success: true, message: `Address ${id} deleted successfully` };
  }
}
