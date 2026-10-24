import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DriverShiftsService {
  // Concurrency lock for slot booking/cancellation
  private slotLocks = new Map<string, Promise<void>>();

  constructor(private prisma: PrismaService) {}

  private async acquireLock(slotId: string): Promise<() => void> {
    while (this.slotLocks.has(slotId)) {
      await this.slotLocks.get(slotId);
    }
    let release: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.slotLocks.delete(slotId);
        resolve();
      };
    });
    this.slotLocks.set(slotId, promise);
    return release!;
  }

  async getShifts() {
    const store = this.prisma.getStore();
    const todayShift = store.shifts.find((s) => s.isToday) || store.shifts[0];
    return {
      todayShift,
      weekSchedule: store.shifts,
    };
  }

  async getSlots(driverId: string, week: 'THIS_WEEK' | 'NEXT_WEEK' = 'THIS_WEEK') {
    const store = this.prisma.getStore();
    const isNextWeek = week === 'NEXT_WEEK';

    // Group slots by date
    const dateMap = new Map<string, any[]>();
    for (const slot of store.slots) {
      if (!dateMap.has(slot.dateKey)) {
        dateMap.set(slot.dateKey, []);
      }

      let status = 'AVAILABLE';
      if (isNextWeek) {
        status = 'LOCKED';
      } else if (slot.bookedRiderIds.includes(driverId)) {
        status = 'BOOKED';
      } else if (slot.bookedRiderIds.length >= (slot.capacity || 5)) {
        status = 'FULL';
      }

      dateMap.get(slot.dateKey)!.push({
        id: slot.id,
        timeRange: slot.timeRange,
        demand: slot.demand,
        bonusText: slot.bonusText,
        capacity: slot.capacity || 5,
        bookedCount: slot.bookedRiderIds.length,
        status,
      });
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayShorts = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const schedule = Array.from(dateMap.entries()).map(([dateKey, slots]) => {
      const date = new Date(dateKey);
      const dayIndex = date.getDay();
      return {
        dateKey,
        dayShort: dayShorts[dayIndex],
        dayName: dayNames[dayIndex],
        dayNumber: date.getDate().toString(),
        dateLabel: `${date.getDate()} Oct`,
        isToday: dateKey === '2026-10-14',
        slots,
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
    const release = await this.acquireLock(slotId);
    try {
      const store = this.prisma.getStore();
      const slot = store.slots.find((s) => s.id === slotId);

      if (!slot) {
        throw new NotFoundException(`Slot ${slotId} not found`);
      }

      // Check if driver already booked
      if (slot.bookedRiderIds.includes(driverId)) {
        throw new ConflictException('You have already booked this delivery slot');
      }

      // Check capacity
      const capacity = slot.capacity || 5;
      if (slot.bookedRiderIds.length >= capacity) {
        throw new BadRequestException('This slot is fully booked');
      }

      slot.bookedRiderIds.push(driverId);

      // Record in-app notification
      store.notifications.unshift({
        id: `notif-${Date.now()}`,
        driverId,
        category: 'SHIFT',
        title: 'Slot Confirmed',
        body: `Your delivery slot for ${slot.timeRange} has been successfully confirmed.`,
        timestamp: 'Just now',
        read: false,
        actionRoute: 'Slots',
        actionLabel: 'View Slot',
        createdAt: new Date().toISOString(),
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
          bookedCount: slot.bookedRiderIds.length,
        },
      };
    } finally {
      release();
    }
  }

  async cancelSlot(driverId: string, slotId: string) {
    const release = await this.acquireLock(slotId);
    try {
      const store = this.prisma.getStore();
      const slot = store.slots.find((s) => s.id === slotId);

      if (!slot) {
        throw new NotFoundException(`Slot ${slotId} not found`);
      }

      const index = slot.bookedRiderIds.indexOf(driverId);
      if (index === -1) {
        throw new NotFoundException('You do not have an active booking for this slot');
      }

      slot.bookedRiderIds.splice(index, 1);

      return {
        success: true,
        message: `Slot booking cancelled for ${slot.timeRange}`,
        slot: {
          id: slot.id,
          dateKey: slot.dateKey,
          timeRange: slot.timeRange,
          status: 'AVAILABLE',
          capacity: slot.capacity || 5,
          bookedCount: slot.bookedRiderIds.length,
        },
      };
    } finally {
      release();
    }
  }
}
