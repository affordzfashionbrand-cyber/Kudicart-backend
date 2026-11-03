import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DeviceTokensService } from './device-tokens.service';
import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsIn(['android', 'ios', 'web'])
  platform: 'android' | 'ios' | 'web';
}

export class UnregisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

@Controller('api/v1/notifications/devices')
@UseGuards(FirebaseAuthGuard)
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException('Authenticated user identity required');
    }

    return this.deviceTokensService.registerToken(
      user.id,
      user.role as any,
      dto.platform,
      dto.token,
    );
  }

  @Post('unregister')
  @HttpCode(HttpStatus.OK)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnregisterDeviceTokenDto,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException('Authenticated user identity required');
    }

    return this.deviceTokensService.unregisterToken(user.id, dto.token);
  }
}
