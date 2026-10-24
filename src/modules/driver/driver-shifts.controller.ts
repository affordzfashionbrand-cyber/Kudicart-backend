import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriverShiftsService } from './driver-shifts.service';
import { BookSlotDto, CancelSlotDto } from './dto/slot-booking.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Controller('api/v1/driver/shifts')
@UseGuards(FirebaseAuthGuard, RateLimitGuard)
export class DriverShiftsController {
  constructor(private readonly shiftsService: DriverShiftsService) {}

  @Get()
  async getShifts() {
    return this.shiftsService.getShifts();
  }

  @Get('slots')
  async getSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week?: 'THIS_WEEK' | 'NEXT_WEEK',
  ) {
    return this.shiftsService.getSlots(user.driverId || user.id, week || 'THIS_WEEK');
  }

  @Post('slots/book')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async bookSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookSlotDto,
  ) {
    return this.shiftsService.bookSlot(user.driverId || user.id, dto.slotId);
  }

  @Post('slots/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async cancelSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelSlotDto,
  ) {
    return this.shiftsService.cancelSlot(user.driverId || user.id, dto.slotId);
  }
}
