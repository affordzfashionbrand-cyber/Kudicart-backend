import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Controller('api/v1/admin/hubs')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminHubsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listActiveHubs() {
    // If PostgreSQL database is connected, query DarkStoreHub model
    if (this.prisma.isConnectedToDb) {
      try {
        const dbHubs = await this.prisma.darkStoreHub.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
        });
        if (dbHubs && dbHubs.length > 0) {
          return {
            success: true,
            data: dbHubs,
            total: dbHubs.length,
          };
        }
      } catch (err) {
        // Fallback to store on database query failure
      }
    }

    // Authoritative in-memory store
    const store = this.prisma.getStore();
    const hubs = (store.darkStores || []).filter((h: any) => h.isActive !== false);

    return {
      success: true,
      data: hubs,
      total: hubs.length,
    };
  }
}
