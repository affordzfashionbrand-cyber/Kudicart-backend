import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CreateDarkStoreHubDto, UpdateDarkStoreHubDto } from '../dto/admin-domain.dto';

@Controller('api/v1/admin/hubs')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminHubsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listActiveHubs(@Query('includeInactive') includeInactive?: string) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }

    const dbHubs = await this.prisma.darkStoreHub.findMany({
      where: includeInactive === 'true' ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: dbHubs,
      total: dbHubs.length,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createHub(
    @Body() dto: CreateDarkStoreHubDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }

    const created = await this.prisma.darkStoreHub.create({
      data: {
        name: dto.name.trim(),
        locality: dto.locality.trim(),
        address: dto.address.trim(),
        lat: dto.lat,
        lng: dto.lng,
        deliveryMinutes: dto.deliveryMinutes ?? 18,
        isActive: dto.isActive ?? true,
      },
    });

    await this.recordAudit(actor, 'CREATE_DARK_STORE_HUB', created.id, {
      name: created.name,
      locality: created.locality,
    });

    return {
      success: true,
      message: 'Dark Store Hub created',
      data: created,
    };
  }

  @Patch(':id')
  async updateHub(
    @Param('id') id: string,
    @Body() dto: UpdateDarkStoreHubDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }

    const existing = await this.prisma.darkStoreHub.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Dark Store Hub ${id} not found`);
    }

    const updated = await this.prisma.darkStoreHub.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.locality !== undefined ? { locality: dto.locality.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
        ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
        ...(dto.deliveryMinutes !== undefined ? { deliveryMinutes: dto.deliveryMinutes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.recordAudit(actor, 'UPDATE_DARK_STORE_HUB', updated.id, {
      name: updated.name,
      isActive: updated.isActive,
    });

    return {
      success: true,
      message: 'Dark Store Hub updated',
      data: updated,
    };
  }

  @Delete(':id')
  async deleteHub(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }

    const existing = await this.prisma.darkStoreHub.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Dark Store Hub ${id} not found`);
    }

    const linkedProducts = await this.prisma.product.count({
      where: { darkStoreHubId: id },
    });

    const result =
      linkedProducts > 0
        ? await this.prisma.darkStoreHub.update({
            where: { id },
            data: { isActive: false },
          })
        : await this.prisma.darkStoreHub.delete({ where: { id } });

    await this.recordAudit(actor, 'DELETE_DARK_STORE_HUB', id, {
      softDeleted: linkedProducts > 0,
      name: existing.name,
    });

    return {
      success: true,
      message: linkedProducts > 0 ? 'Dark Store Hub deactivated' : 'Dark Store Hub deleted',
      data: result,
    };
  }

  private async recordAudit(
    actor: AuthenticatedUser | undefined,
    action: string,
    entityId: string,
    details: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor?.id || 'ADMIN',
          userEmail: actor?.email || null,
          userRole: 'ADMIN',
          action,
          entityType: 'DarkStoreHub',
          entityId,
          details: JSON.stringify(details),
        },
      });
    } catch {
      // Non-blocking audit persistence
    }
  }
}
