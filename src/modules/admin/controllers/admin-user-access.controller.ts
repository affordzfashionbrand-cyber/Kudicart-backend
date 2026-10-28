import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminAccessService } from '../services/admin-access.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import {
  CreateAdminUserDto,
  UpdateAdminUserRoleDto,
  UpdateRolePermissionsDto,
} from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/user-access')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUserAccessController {
  constructor(private readonly accessService: AdminAccessService) {}

  @Get('users')
  async listUsers(@Query() query: AdminQueryDto) {
    return this.accessService.listUsers(query);
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  async inviteUser(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accessService.inviteUser(dto, actor?.id, actor?.name);
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accessService.updateUserRole(id, dto, actor?.id, actor?.name);
  }

  @Get('roles')
  async listRoles() {
    return this.accessService.listRoles();
  }

  @Get('role-permissions')
  async getRolePermissions() {
    return this.accessService.getRolePermissions();
  }

  @Put('role-permissions')
  async updateRolePermissions(
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accessService.updateRolePermissions(dto, actor?.id, actor?.name);
  }
}

