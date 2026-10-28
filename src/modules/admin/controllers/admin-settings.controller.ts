import {
  Controller,
  Get,
  Patch,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminSettingsService } from '../services/admin-settings.service';
import { WorkspacePreferencesDto } from '../dto/admin-domain.dto';
import { UpdateAdminProfileDto } from '../dto/admin-actions.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/settings')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settingsService: AdminSettingsService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.getProfileAndSession(user.id);
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAdminProfileDto,
  ) {
    return this.settingsService.updateProfile(user.id, dto);
  }

  @Get('preferences')
  async getPreferences() {
    return this.settingsService.getPreferences();
  }

  @Put('preferences')
  async savePreferences(@Body() dto: WorkspacePreferencesDto) {
    return this.settingsService.savePreferences(dto);
  }
}

