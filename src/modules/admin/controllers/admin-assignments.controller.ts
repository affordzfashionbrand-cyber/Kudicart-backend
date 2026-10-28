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

@Controller('api/v1/admin/assignments')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminAssignmentsController {
  constructor(private readonly ordersService: AdminOrdersService) {}

  @Get()
  async listAssignments(@Query() query: AdminQueryDto) {
    return this.ordersService.listAssignments(query);
  }

  @Post(':orderId/assign')
  @HttpCode(HttpStatus.OK)
  async assignDriver(
    @Param('orderId') orderId: string,
    @Body() dto: AdminAssignDriverDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.assignDriver(orderId, dto, actor?.id, actor?.name);
  }
}

