import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AddressService {
  constructor(private prisma: PrismaService) {}

  async getAddresses(userId: string) {
    return this.prisma.getStore().addresses.filter((a) => a.userId === userId);
  }

  async addAddress(userId: string, data: any) {
    const store = this.prisma.getStore();
    const newAddr = {
      id: `addr-${Date.now()}`,
      userId,
      label: data.label || 'Home',
      line1: data.line1,
      locality: data.locality,
      city: data.city,
      isDefault: data.isDefault || false,
    };
    store.addresses.push(newAddr);
    return newAddr;
  }
}
