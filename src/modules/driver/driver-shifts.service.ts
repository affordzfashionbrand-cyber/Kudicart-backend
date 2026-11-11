import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORTS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

@Injectable()
export class DriverShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private getTodayIsoKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getShifts() {
    this.ensureDbConnected();

    const shifts = await this.prisma.driverShift.findMany({
      orderBy: [{ displayOrder: 'asc' }, { dayOfWeek: 'asc' }],
    });

    // DB stores dayOfWeek 0..6 starting Monday (0 = Mon, 6 = Sun)
    const mondayBasedToday = (new Date().getDay() + 6) % 7;

    const weekSchedule = shifts.map((shift) => ({
      id: shift.id,
      dayOfWeek: shift.dayOfWeek,
      day: shift.day,
      dateStr: shift.dateStr,
      timeRange: shift.timeRange,
      duration: shift.duration,
      hub: shift.hub,
      hubAddress: shift.hubAddress,
      status: shift.status,
      statusLabel: shift.statusLabel,
      breakTime: shift.breakTime,
      attendance: shift.attendance,
      isToday: shift.dayOfWeek === mondayBasedToday,
    }));

    const todayShift = weekSchedule.find((s) => s.isToday) || weekSchedule[0] || null;

    return {
      todayShift,
      weekSchedule,
    };
  }

  async getSlots(driverId: string, week: 'THIS_WEEK' | 'NEXT_WEEK' = 'THIS_WEEK') {
    this.ensureDbConnected();

    const isNextWeek = week === 'NEXT_WEEK';
    const slots = await this.prisma.driverSlot.findMany({
      include: { bookings: true },
      orderBy: [{ dateKey: 'asc' }, { timeRange: 'asc' }],
    });

    const todayKey = this.getTodayIsoKey();
    const dateMap = new Map<string, any[]>();

    for (const slot of slots) {
      const effectiveDateKey = isNextWeek
        ? (() => {
            const d = new Date(`${slot.dateKey}T00:00:00Z`);
            if (Number.isNaN(d.getTime())) return slot.dateKey;
            d.setUTCDate(d.getUTCDate() + 7);
            return d.toISOString().slice(0, 10);
          })()
        : slot.dateKey;

      if (!dateMap.has(effectiveDateKey)) {
        dateMap.set(effectiveDateKey, []);
      }

      const activeBookings = (slot.bookings || []).filter((b) => b.status === 'BOOKED');
      const isBookedByMe = activeBookings.some((b) => b.driverId === driverId);
      const capacity = slot.capacity || 5;

      let status = 'AVAILABLE';
      if (isNextWeek || slot.isLocked) {
        status = 'LOCKED';
      } else if (isBookedByMe) {
        status = 'BOOKED';
      } else if (activeBookings.length >= capacity) {
        status = 'FULL';
      }

      dateMap.get(effectiveDateKey)!.push({
        id: slot.id,
        timeRange: slot.timeRange,
        demand: slot.demand,
        bonusText: slot.bonusText,
        capacity,
        bookedCount: activeBookings.length,
        status,
      });
    }

    const schedule = Array.from(dateMap.entries()).map(([dateKey, daySlots]) => {
      const date = new Date(`${dateKey}T00:00:00`);
      const valid = !Number.isNaN(date.getTime());
      const dayIndex = valid ? date.getDay() : 0;
      const monthName = valid ? MONTH_SHORTS[date.getMonth()] : '';
      const dayNumber = valid ? String(date.getDate()) : '';

      return {
        dateKey,
        dayShort: DAY_SHORTS[dayIndex],
        dayName: DAY_NAMES[dayIndex],
        dayNumber,
        dateLabel: valid ? `${date.getDate()} ${monthName}` : dateKey,
        isToday: !isNextWeek && dateKey === todayKey,
        slots: daySlots,
      };
    });

    return {
      week,
      isLocked: isNextWeek,
      lockMessage: isNextWeek ? 'Next week schedule is locked until Friday 6:00 PM.' : null,
      schedule,
    };
  }

  async bookSlot(driverId: string, slotId: string) {
    this.ensureDbConnected();

    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.driverSlot.findUnique({
        where: { id: slotId },
        include: {
          bookings: {
            where: { status: 'BOOKED' },
          },
        },
      });

      if (!slot) {
        throw new NotFoundException(`Slot ${slotId} not found`);
      }

      if (slot.isLocked) {
        throw new BadRequestException('This slot is currently locked and cannot be booked.');
      }

      if (slot.bookings.some((b) => b.driverId === driverId)) {
        throw new ConflictException('You have already booked this delivery slot');
      }

      const capacity = slot.capacity || 5;
      if (slot.bookings.length >= capacity) {
        throw new BadRequestException('This slot is fully booked');
      }

      await tx.driverSlotBooking.create({
        data: {
          slotId: slot.id,
          driverId,
          status: 'BOOKED',
        },
      });

      await tx.driverNotification.create({
        data: {
          driverId,
          category: 'SHIFT',
          title: 'Slot Confirmed',
          body: `Your delivery slot for ${slot.timeRange} on ${slot.dateKey} has been successfully confirmed.`,
          read: false,
          actionRoute: 'Slots',
          actionLabel: 'View Slot',
        },
      });

      return {
        success: true,
        message: `Slot booked successfully for ${slot.timeRange}`,
        slot: {
          id: slot.id,
          dateKey: slot.dateKey,
          timeRange: slot.timeRange,
          status: 'BOOKED',
          capacity,
          bookedCount: slot.bookings.length + 1,
        },
      };
    });
  }

  async cancelSlot(driverId: string, slotId: string) {
    this.ensureDbConnected();

    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.driverSlot.findUnique({
        where: { id: slotId },
        include: {
          bookings: {
            where: { status: 'BOOKED' },
          },
        },
      });

      if (!slot) {
        throw new NotFoundException(`Slot ${slotId} not found`);
      }

      const existingBooking = slot.bookings.find((b) => b.driverId === driverId);
      if (!existingBooking) {
        throw new NotFoundException('You do not have an active booking for this slot');
      }

      await tx.driverSlotBooking.delete({
        where: { id: existingBooking.id },
      });

      return {
        success: true,
        message: `Slot booking cancelled for ${slot.timeRange}`,
        slot: {
          id: slot.id,
          dateKey: slot.dateKey,
          timeRange: slot.timeRange,
          status: 'AVAILABLE',
          capacity: slot.capacity || 5,
          bookedCount: Math.max(0, slot.bookings.length - 1),
        },
      };
    });
  }
}
