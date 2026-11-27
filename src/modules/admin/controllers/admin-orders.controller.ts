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

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptOrder(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.acceptOrder(id, actor?.id, actor?.name);
  }

  @Post(':id/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareOrder(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.prepareOrder(id, actor?.id, actor?.name);
  }

  @Post(':id/ready-for-pickup')
  @HttpCode(HttpStatus.OK)
  async readyForPickup(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.readyForPickup(id, actor?.id, actor?.name);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('id') id: string,
    @Body() body: { reason?: string; expectedVersion?: number },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.cancelOrder(
      id,
      actor?.id,
      actor?.name,
      body?.reason,
      body?.expectedVersion,
    );
  }

  @Post(':id/retry-assignment')
  @HttpCode(HttpStatus.OK)
  async retryAssignment(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.retryAssignment(id, actor?.id, actor?.name);
  }

  @Post(':id/reconcile-return')
  @HttpCode(HttpStatus.OK)
  async reconcileReturn(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.reconcileReturn(id, actor?.id, actor?.name, body?.note);
  }
}

