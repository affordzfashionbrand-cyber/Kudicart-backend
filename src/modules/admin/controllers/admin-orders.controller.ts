import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminOrdersService } from '../services/admin-orders.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminAssignDriverDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/orders')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminOrdersController {
  constructor(private readonly ordersService: AdminOrdersService) {}

  @Get()
  async listOrders(@Query() query: AdminQueryDto) {
    return this.ordersService.listOrders(query);
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Post(':id/assign-driver')
  @HttpCode(HttpStatus.OK)
  async assignDriver(
    @Param('id') id: string,
    @Body() dto: AdminAssignDriverDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.assignDriver(id, dto, actor?.id, actor?.name);
  }
}

