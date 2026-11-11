import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Optional,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriverOrdersService } from './driver-orders.service';
import { OrderPickupDto, OrderDeliverDto } from './dto/order-action.dto';
import {
  TryAndBuyHandoverDto,
  TryAndBuySelectionsDto,
  TryAndBuyReturnCollectionDto,
  TryAndBuySettlePaymentDto,
  TryAndBuyReconciliationDto,
} from './dto/try-and-buy.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIdempotency } from '../../common/utils/idempotency.util';

@Controller('api/v1/driver')
@UseGuards(FirebaseAuthGuard, RolesGuard, RateLimitGuard)
@Roles(Role.DRIVER)
export class DriverOrdersController {
  constructor(
    private readonly ordersService: DriverOrdersService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private withIdempotency<T>(
    user: AuthenticatedUser,
    scope: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.prisma || !idempotencyKey?.trim()) {
      return fn();
    }
    return runWithIdempotency(
      this.prisma,
      {
        userId: user.id,
        scope,
        key: idempotencyKey,
        payload,
      },
      fn,
    );
  }

  @Get('dashboard')
  async getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.getDashboard(user.driverId || user.id);
  }

  @Get('orders')
  async getAssignedOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.ordersService.getAssignedOrders(user.driverId || user.id, status);
  }

  @Get('orders/:id')
  async getOrderDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderDetails(user.driverId || user.id, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async acceptOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(user, `driver:accept:${id}`, idempotencyKey, { id }, () =>
      this.ordersService.acceptOrder(user.driverId || user.id, id),
    );
  }

  @Post('orders/:id/pickup')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async pickupOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto?: OrderPickupDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(user, `driver:pickup:${id}`, idempotencyKey, { id, dto }, () =>
      this.ordersService.pickupOrder(user.driverId || user.id, id, dto),
    );
  }

  @Post('orders/:id/out-for-delivery')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async outForDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:out-for-delivery:${id}`,
      idempotencyKey,
      { id },
      () => this.ordersService.outForDelivery(user.driverId || user.id, id),
    );
  }

  @Post('orders/:id/arrived')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async markArrived(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(user, `driver:arrived:${id}`, idempotencyKey, { id }, () =>
      this.ordersService.markArrived(user.driverId || user.id, id),
    );
  }

  @Post('orders/:id/deliver')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async deliverOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto?: OrderDeliverDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(user, `driver:deliver:${id}`, idempotencyKey, { id, dto }, () =>
      this.ordersService.deliverOrder(user.driverId || user.id, id, dto),
    );
  }

  // --------------------------------------------------------------------------
  // TRY & BUY WORKFLOW ENDPOINTS
  // --------------------------------------------------------------------------

  @Post('orders/:id/try-and-buy/handover')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async tryAndBuyHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TryAndBuyHandoverDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-handover:${id}`,
      idempotencyKey,
      { id, dto },
      () => this.ordersService.tryAndBuyHandover(user.driverId || user.id, id, dto),
    );
  }

  @Post('orders/:id/try-and-buy/selections')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async tryAndBuySelections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TryAndBuySelectionsDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-selections:${id}`,
      idempotencyKey,
      { id, dto },
      () => this.ordersService.tryAndBuySelections(user.driverId || user.id, id, dto),
    );
  }

  @Post('orders/:id/try-and-buy/return-collection')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async tryAndBuyReturnCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TryAndBuyReturnCollectionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-return-collection:${id}`,
      idempotencyKey,
      { id, dto },
      () => this.ordersService.tryAndBuyReturnCollection(user.driverId || user.id, id, dto),
    );
  }

  @Post('orders/:id/try-and-buy/settle-payment')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async tryAndBuySettlePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TryAndBuySettlePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-settle:${id}`,
      idempotencyKey,
      { id, dto },
      () => this.ordersService.tryAndBuySettlePayment(user.driverId || user.id, id, dto),
    );
  }

  @Post('orders/:id/try-and-buy/arrive-store')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async tryAndBuyArriveStore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-arrive:${id}`,
      idempotencyKey,
      { id },
      () => this.ordersService.tryAndBuyArriveStore(user.driverId || user.id, id),
    );
  }

  @Post('orders/:id/try-and-buy/reconcile-store')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async tryAndBuyReconcileStore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TryAndBuyReconciliationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.withIdempotency(
      user,
      `driver:tnb-reconcile:${id}`,
      idempotencyKey,
      { id, dto },
      () => this.ordersService.tryAndBuyReconcileStore(user.driverId || user.id, id, dto),
    );
  }
}
