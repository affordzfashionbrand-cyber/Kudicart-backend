import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DriverEarningsService {
  constructor(private prisma: PrismaService) {}

  async getEarnings(weekIndex = 0) {
    const store = this.prisma.getStore();
    const targetWeek = store.earningsWeeks.find((w) => w.id === weekIndex) || store.earningsWeeks[0];

    return {
      activeWeekIndex: targetWeek.id,
      label: targetWeek.label,
      totalEarnings: targetWeek.totalEarnings,
      orderPay: targetWeek.orderPay,
      bonus: targetWeek.bonus,
      deliveries: targetWeek.deliveries,
      activeHours: targetWeek.activeHours,
      days: targetWeek.days,
      availableWeeks: store.earningsWeeks.map((w) => ({
        id: w.id,
        label: w.label,
        totalEarnings: `₹ ${w.totalEarnings.toLocaleString('en-IN')}`,
      })),
    };
  }

  async getBonusProgress(driverId?: string) {
    const store = this.prisma.getStore();
    const driver = store.drivers.find((d) => d.id === driverId || d.userId === driverId) || store.drivers[0];
    const completedOrders = driver.workSummary?.ordersDone || 8;

    return {
      dailyBonus: {
        completedOrders,
        targetOrders: 10,
        rewardEarned: 0,
        nextReward: 150,
        ordersRemaining: Math.max(0, 10 - completedOrders),
        status: completedOrders >= 10 ? 'COMPLETED' : 'IN_PROGRESS',
        milestones: [
          { orders: 5, bonus: 60, reached: completedOrders >= 5 },
          { orders: 10, bonus: 150, reached: completedOrders >= 10 },
          { orders: 15, bonus: 250, reached: completedOrders >= 15 },
        ],
      },
      weeklyBonus: {
        completedOrders: 39,
        targetOrders: 50,
        rewardEarned: 200,
        nextReward: 500,
        ordersRemaining: 11,
        workingDays: 4,
        targetWorkingDays: 6,
        status: 'IN_PROGRESS',
        milestones: [
          { orders: 25, bonus: 200, reached: true },
          { orders: 50, bonus: 500, reached: false },
          { orders: 75, bonus: 900, reached: false },
        ],
      },
    };
  }

  async getOpportunities() {
    return [
      {
        id: 'opp-1',
        title: 'Peak Dinner Rush',
        timeWindow: '07:00 PM – 10:00 PM',
        bonusText: '+₹100 bonus on 5 deliveries',
        zone: 'HSR Layout & Koramangala Hubs',
        urgency: 'High Demand',
      },
      {
        id: 'opp-2',
        title: 'Weekend Super-Booster',
        timeWindow: 'Saturday & Sunday All Day',
        bonusText: 'Earn up to ₹1,200 extra this weekend',
        zone: 'All Southeast Bengaluru Zones',
        urgency: 'Top Incentive',
      },
    ];
  }

  async getSurges() {
    const store = this.prisma.getStore();
    const activeSurges = store.surges.filter((s) => s.isActive);
    return {
      activeSurges,
      count: activeSurges.length,
    };
  }
}
