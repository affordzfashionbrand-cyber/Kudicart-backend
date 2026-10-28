import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from '../services/admin-users.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateCustomerStatusDto } from '../dto/admin-actions.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/users')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  async listCustomers(@Query() query: AdminQueryDto) {
    return this.usersService.listCustomers(query);
  }

  @Get(':id')
  async getCustomerById(@Param('id') id: string) {
    return this.usersService.getCustomerById(id);
  }

  @Patch(':id/status')
  async updateCustomerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.updateCustomerStatus(
      id,
      dto,
      actor?.id,
      actor?.name,
    );
  }
}

