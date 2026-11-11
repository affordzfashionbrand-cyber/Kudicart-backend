import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const BASE_DELIVERY_PAYOUT_RUPEES = 55;
const DAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT_NAMES = [
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
export class DriverEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
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
      `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORT_NAMES[d.getMonth()]}`;

    return {
      monday,
      sunday,
      label:
        weekIndex === 0
          ? `This Week (${formatShort(monday)} – ${formatShort(sunday)})`
          : weekIndex === 1
            ? `Last Week (${formatShort(monday)} – ${formatShort(sunday)})`
            : `${formatShort(monday)} – ${formatShort(sunday)}`,
    };
  }

  private async resolveDriverScope(driverId?: string) {
    if (!driverId) {
      return null;
    }

    return this.prisma.driverProfile.findFirst({
      where: {
        OR: [{ id: driverId }, { userId: driverId }],
      },
      select: {
        id: true,
        userId: true,
        completedDeliveries: true,
      },
    });
  }

  private computeWeekStats(
    weekIndex: number,
    orders: Array<{ id: string; deliveredAt: Date | null; updatedAt: Date }>,
    ledgerEntries: Array<{
      entryType: string;
      amount: number;
      createdAt: Date;
    }>,
  ) {
    const { monday, sunday, label } = this.getWeekBounds(weekIndex);

    const dayBuckets = DAY_SHORT_NAMES.map((dayName, idx) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + idx);
      const isoKey = date.toISOString().slice(0, 10);
      return {
        isoKey,
        dayName,
        dateLabel: `${String(date.getDate()).padStart(2, '0')} ${MONTH_SHORT_NAMES[date.getMonth()]}`,
        deliveries: 0,
        orderPay: 0,
        bonus: 0,
        earnings: 0,
      };
    });

    const dayByIso = new Map(dayBuckets.map((d) => [d.isoKey, d]));

    let orderPay = 0;
    let bonus = 0;
    let deliveries = 0;

    for (const order of orders) {
      const ts = order.deliveredAt || order.updatedAt;
      if (ts >= monday && ts <= sunday) {
        const key = ts.toISOString().slice(0, 10);
        const bucket = dayByIso.get(key);
        deliveries += 1;
        orderPay += BASE_DELIVERY_PAYOUT_RUPEES;
        if (bucket) {
          bucket.deliveries += 1;
          bucket.orderPay += BASE_DELIVERY_PAYOUT_RUPEES;
          bucket.earnings += BASE_DELIVERY_PAYOUT_RUPEES;
        }
      }
    }

    for (const entry of ledgerEntries) {
      if (entry.createdAt >= monday && entry.createdAt <= sunday) {
        const amt = Math.max(0, Math.round(entry.amount || 0));
        const key = entry.createdAt.toISOString().slice(0, 10);
        const bucket = dayByIso.get(key);
        if (entry.entryType === 'DRIVER_BONUS' || entry.entryType === 'SURGE_BONUS') {
          bonus += amt;
          if (bucket) {
            bucket.bonus += amt;
            bucket.earnings += amt;
          }
        }
      }
    }

    const totalEarnings = orderPay + bonus;
    const activeHours = deliveries > 0 ? Number((deliveries * 0.45).toFixed(1)) : 0;

    return {
      id: weekIndex,
      label,
      totalEarnings,
      orderPay,
      bonus,
      deliveries,
      activeHours,
      days: dayBuckets,
    };
  }

  async getEarnings(driverIdOrWeekIndex?: string | number, weekIndexArg = 0) {
    this.ensureDbConnected();

    let driverId: string | undefined;
    let requestedWeekIndex = 0;

    if (typeof driverIdOrWeekIndex === 'number') {
      requestedWeekIndex = Number.isFinite(driverIdOrWeekIndex)
        ? Math.max(0, Math.min(3, Math.trunc(driverIdOrWeekIndex)))
        : 0;
    } else {
      driverId = driverIdOrWeekIndex;
      requestedWeekIndex = Number.isFinite(weekIndexArg)
        ? Math.max(0, Math.min(3, Math.trunc(weekIndexArg)))
        : 0;
    }

    const driver = await this.resolveDriverScope(driverId);
    const oldestBounds = this.getWeekBounds(3).monday;

    const orderWhere: any = {
      status: { in: ['DELIVERED', 'RETURNED'] },
      OR: [
        { deliveredAt: { gte: oldestBounds } },
        { AND: [{ deliveredAt: null }, { updatedAt: { gte: oldestBounds } }] },
      ],
    };

    const ledgerWhere: any = {
      entryType: { in: ['DRIVER_PAYOUT', 'DRIVER_BONUS', 'SURGE_BONUS'] },
      createdAt: { gte: oldestBounds },
    };

    if (driver) {
      orderWhere.AND = [
        ...(orderWhere.AND || []),
        { OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }] },
      ];
      ledgerWhere.OR = [{ driverId: driver.id }, { driverId: driver.userId }];
    } else if (driverId) {
      orderWhere.AND = [
        ...(orderWhere.AND || []),
        { OR: [{ driverProfileId: driverId }, { driverId }] },
      ];
      ledgerWhere.driverId = driverId;
    }

    const [orders, ledgerEntries] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        select: { id: true, deliveredAt: true, updatedAt: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: ledgerWhere,
        select: { entryType: true, amount: true, createdAt: true },
      }),
    ]);

    const weeks = [0, 1, 2, 3].map((idx) =>
      this.computeWeekStats(idx, orders, ledgerEntries),
    );
    const targetWeek = weeks.find((w) => w.id === requestedWeekIndex) || weeks[0];

    return {
      activeWeekIndex: targetWeek.id,
      label: targetWeek.label,
      totalEarnings: targetWeek.totalEarnings,
      orderPay: targetWeek.orderPay,
      bonus: targetWeek.bonus,
      deliveries: targetWeek.deliveries,
      activeHours: targetWeek.activeHours,
      days: targetWeek.days,
      availableWeeks: weeks.map((w) => ({
        id: w.id,
        label: w.label,
        totalEarnings: `₹ ${w.totalEarnings.toLocaleString('en-IN')}`,
      })),
    };
  }

  async getBonusProgress(driverId?: string) {
    this.ensureDbConnected();

    const driver = await this.resolveDriverScope(driverId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = this.getWeekBounds(0).monday;

    const ownerFilter = driver
      ? { OR: [{ driverProfileId: driver.id }, { driverId: driver.userId }] }
      : driverId
        ? { OR: [{ driverProfileId: driverId }, { driverId }] }
        : undefined;

    const [todayDeliveries, weeklyOrders] = await Promise.all([
      this.prisma.order.count({
        where: {
          ...(ownerFilter || {}),
          status: { in: ['DELIVERED', 'RETURNED'] },
          OR: [
            { deliveredAt: { gte: todayStart } },
            { AND: [{ deliveredAt: null }, { updatedAt: { gte: todayStart } }] },
          ],
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...(ownerFilter || {}),
          status: { in: ['DELIVERED', 'RETURNED'] },
          OR: [
            { deliveredAt: { gte: weekStart } },
            { AND: [{ deliveredAt: null }, { updatedAt: { gte: weekStart } }] },
          ],
        },
        select: { deliveredAt: true, updatedAt: true },
      }),
    ]);

    const weeklyDeliveries = weeklyOrders.length;
    const workingDays = new Set(
      weeklyOrders.map((o) => (o.deliveredAt || o.updatedAt).toISOString().slice(0, 10)),
    ).size;

    const dailyMilestones = [
      { orders: 5, bonus: 60, reached: todayDeliveries >= 5 },
      { orders: 10, bonus: 150, reached: todayDeliveries >= 10 },
      { orders: 15, bonus: 250, reached: todayDeliveries >= 15 },
    ];
    const dailyRewardEarned = dailyMilestones
      .filter((m) => m.reached)
      .reduce((max, m) => Math.max(max, m.bonus), 0);
    const nextDailyMilestone = dailyMilestones.find((m) => !m.reached) || dailyMilestones[2];

    const weeklyMilestones = [
      { orders: 25, bonus: 200, reached: weeklyDeliveries >= 25 },
      { orders: 50, bonus: 500, reached: weeklyDeliveries >= 50 },
      { orders: 75, bonus: 900, reached: weeklyDeliveries >= 75 },
    ];
    const weeklyRewardEarned = weeklyMilestones
      .filter((m) => m.reached)
      .reduce((max, m) => Math.max(max, m.bonus), 0);
    const nextWeeklyMilestone =
      weeklyMilestones.find((m) => !m.reached) || weeklyMilestones[2];

    return {
      dailyBonus: {
        completedOrders: todayDeliveries,
        targetOrders: nextDailyMilestone.orders,
        rewardEarned: dailyRewardEarned,
        nextReward: nextDailyMilestone.bonus,
        ordersRemaining: Math.max(0, nextDailyMilestone.orders - todayDeliveries),
        status: todayDeliveries >= 15 ? 'COMPLETED' : 'IN_PROGRESS',
        milestones: dailyMilestones,
      },
      weeklyBonus: {
        completedOrders: weeklyDeliveries,
        targetOrders: nextWeeklyMilestone.orders,
        rewardEarned: weeklyRewardEarned,
        nextReward: nextWeeklyMilestone.bonus,
        ordersRemaining: Math.max(0, nextWeeklyMilestone.orders - weeklyDeliveries),
        workingDays,
        targetWorkingDays: 6,
        status: weeklyDeliveries >= 75 ? 'COMPLETED' : 'IN_PROGRESS',
        milestones: weeklyMilestones,
      },
    };
  }

  async getOpportunities() {
    this.ensureDbConnected();
    const activeSurges = await this.prisma.driverSurge.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (activeSurges.length > 0) {
      return activeSurges.map((s) => ({
        id: s.id,
        title: s.title,
        timeWindow: s.timeWindow,
        bonusText: `+₹${s.bonusAmount} bonus per eligible delivery`,
        zone: s.area,
        urgency: 'High Demand',
      }));
    }

    return [
      {
        id: 'opp-1',
        title: 'Peak Dinner Rush',
        timeWindow: '07:00 PM – 10:00 PM',
        bonusText: '+₹100 bonus on 5 deliveries',
        zone: 'Indiranagar & Koramangala Hubs',
        urgency: 'High Demand',
      },
      {
        id: 'opp-2',
        title: 'Weekend Super-Booster',
        timeWindow: 'Saturday & Sunday All Day',
        bonusText: 'Earn up to ₹1,200 extra this weekend',
        zone: 'All Bengaluru Hubs',
        urgency: 'Top Incentive',
      },
    ];
  }

  async getSurges() {
    this.ensureDbConnected();
    const rows = await this.prisma.driverSurge.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const activeSurges = rows.map((s) => ({
      ...s,
      headline: s.title,
      zone: s.area,
      timeRemaining: s.timeWindow,
    }));

    return {
      activeSurges,
      count: activeSurges.length,
    };
  }
}
