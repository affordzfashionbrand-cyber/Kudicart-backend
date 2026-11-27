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

  private getWeekBounds(weekIndex: number) {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() + diffToMonday - weekIndex * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const formatShort = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORTS[d.getMonth()]}`;

    return {
      monday,
      sunday,
      mondayIso: monday.toISOString().slice(0, 10),
      sundayIso: sunday.toISOString().slice(0, 10),
      label:
        weekIndex === 0
          ? `This Week (${formatShort(monday)} – ${formatShort(sunday)})`
          : weekIndex === 1
            ? `Last Week (${formatShort(monday)} – ${formatShort(sunday)})`
            : `${formatShort(monday)} – ${formatShort(sunday)}`,
    };
  }

  private parseDurationHours(rangeOrDuration?: string | null): number {
    if (!rangeOrDuration) return 0;
    const hrMatch = rangeOrDuration.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours|h)\b/i);
    if (hrMatch) return parseFloat(hrMatch[1]) || 0;

    const times = rangeOrDuration.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi);
    if (times && times.length >= 2) {
      const toMinutes = (raw: string) => {
        const m = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!m) return 0;
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const mer = (m[3] || '').toUpperCase();
        if (mer === 'PM' && h < 12) h += 12;
        if (mer === 'AM' && h === 12) h = 0;
        return h * 60 + min;
      };
      let diff = toMinutes(times[1]) - toMinutes(times[0]);
      if (diff <= 0) diff += 24 * 60;
      return Math.round((diff / 60) * 10) / 10;
    }
    return 0;
  }

  async getShifts(driverId?: string) {
    this.ensureDbConnected();

    const shifts = await this.prisma.driverShift.findMany({
      where: driverId ? { driverId } : undefined,
      orderBy: [{ displayOrder: 'asc' }, { dayOfWeek: 'asc' }],
    });

    // DB stores dayOfWeek 0..6 starting Monday (0 = Mon, 6 = Sun)
    const mondayBasedToday = (new Date().getDay() + 6) % 7;

    const weekSchedule = shifts.map((shift) => ({
      id: shift.id,
      driverId: shift.driverId ?? null,
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

  async getHistory(driverId: string, weekIndex = 0) {
    this.ensureDbConnected();

    const normalizedWeek = Math.max(0, Math.min(12, Math.floor(weekIndex || 0)));
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverId }, { userId: driverId }] },
      select: { id: true, userId: true, workPreference: true },
    });

    const effectiveDriverId = driver?.id || driverId;
    const workPreference =
      (driver?.workPreference || 'FULL_TIME').toUpperCase() === 'PART_TIME'
        ? 'PART_TIME'
        : 'FULL_TIME';

    const { monday, sunday, mondayIso, sundayIso, label } =
      this.getWeekBounds(normalizedWeek);

    const weekOptions = [0, 1, 2, 3].map((idx) => {
      const b = this.getWeekBounds(idx);
      return { weekIndex: idx, label: b.label };
    });

    const basePayout = Number(process.env.DRIVER_BASE_PAYOUT_RUPEES) || 55;
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['DELIVERED', 'RETURNED'] },
        AND: [
          {
            OR: [
              { driverProfileId: effectiveDriverId },
              ...(driver?.userId ? [{ driverId: driver.userId }] : []),
            ],
          },
          {
            OR: [
              { deliveredAt: { gte: monday, lte: sunday } },
              { AND: [{ deliveredAt: null }, { updatedAt: { gte: monday, lte: sunday } }] },
            ],
          },
        ],
      },
      select: { id: true, deliveredAt: true, updatedAt: true },
    });

    const orderIds = orders.map((o) => o.id);
    const ledgerEntries = orderIds.length
      ? await this.prisma.ledgerEntry.findMany({
          where: {
            orderId: { in: orderIds },
            entryType: 'DRIVER_PAYOUT',
          },
          select: { orderId: true, amount: true },
        })
      : [];

    const payoutByOrder = new Map<string, number>();
    for (const l of ledgerEntries) {
      if (l.orderId) {
        payoutByOrder.set(
          l.orderId,
          (payoutByOrder.get(l.orderId) || 0) + Math.max(0, Math.round(l.amount || 0)),
        );
      }
    }

    const totalEarnings = orders.reduce(
      (sum, o) => sum + (payoutByOrder.get(o.id) ?? basePayout),
      0,
    );

    if (workPreference === 'FULL_TIME') {
      const shifts = await this.prisma.driverShift.findMany({
        where: {
          driverId: effectiveDriverId,
          ...(normalizedWeek > 0
            ? {
                shiftDate: { gte: monday, lte: sunday },
              }
            : {}),
        },
        orderBy: [{ displayOrder: 'asc' }, { dayOfWeek: 'asc' }],
      });

      const items = shifts.map((s) => ({
        id: s.id,
        day: s.day,
        dateLabel: s.dateStr,
        timeRange: s.timeRange,
        duration: s.duration,
        hub: s.hub,
        hubAddress: s.hubAddress,
        status: s.status,
        statusLabel: s.statusLabel,
        attendance: s.attendance || (s.status === 'COMPLETED' ? 'Present' : s.statusLabel),
        breakTime: s.breakTime || null,
        hours: this.parseDurationHours(s.duration) || this.parseDurationHours(s.timeRange),
      }));

      const totalHours = Math.round(items.reduce((sum, i) => sum + i.hours, 0) * 10) / 10;
      const presentCount = items.filter((i) =>
        (i.attendance || '').toLowerCase().includes('present') ||
        (i.status || '').toUpperCase() === 'COMPLETED',
      ).length;

      return {
        mode: 'SHIFT_HISTORY',
        workPreference,
        weekIndex: normalizedWeek,
        label,
        totalShifts: items.length,
        completedShifts: presentCount,
        totalHours,
        deliveries: orders.length,
        totalEarnings,
        items,
        availableWeeks: weekOptions,
      };
    }

    const bookings = await this.prisma.driverSlotBooking.findMany({
      where: {
        driverId: effectiveDriverId,
        status: 'BOOKED',
        slot: {
          dateKey: { gte: mondayIso, lte: sundayIso },
        },
      },
      include: { slot: true },
      orderBy: [{ bookedAt: 'desc' }],
    });

    const items = bookings.map((b) => {
      const d = new Date(`${b.slot.dateKey}T00:00:00`);
      const valid = !Number.isNaN(d.getTime());
      const hours = this.parseDurationHours(b.slot.timeRange);
      return {
        id: b.id,
        slotId: b.slotId,
        day: valid ? DAY_SHORTS[d.getDay()] : b.slot.dateKey,
        dateLabel: valid ? `${d.getDate()} ${MONTH_SHORTS[d.getMonth()]}` : b.slot.dateKey,
        dateKey: b.slot.dateKey,
        timeRange: b.slot.timeRange,
        duration: hours > 0 ? `${hours} hrs` : '',
        demand: b.slot.demand,
        bonusText: b.slot.bonusText || null,
        status: b.status,
        statusLabel: 'Booked',
        hours,
      };
    });

    const bookedHours = Math.round(items.reduce((sum, i) => sum + i.hours, 0) * 10) / 10;

    return {
      mode: 'SLOT_HISTORY',
      workPreference,
      weekIndex: normalizedWeek,
      label,
      completedSlots: items.length,
      bookedHours,
      deliveries: orders.length,
      totalEarnings,
      items,
      availableWeeks: weekOptions,
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
