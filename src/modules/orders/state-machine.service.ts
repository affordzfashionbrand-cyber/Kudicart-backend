import { Injectable, BadRequestException } from '@nestjs/common';

export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED';

@Injectable()
export class StateMachineService {
  private readonly validTransitions: Record<OrderStatus, OrderStatus[]> = {
    PLACED: ['ACCEPTED'],
    ACCEPTED: ['PREPARING'],
    PREPARING: ['READY_FOR_PICKUP'],
    READY_FOR_PICKUP: ['ASSIGNED'],
    ASSIGNED: ['PICKED_UP'],
    PICKED_UP: ['OUT_FOR_DELIVERY'],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    DELIVERED: [],
  };

  validateTransition(current: OrderStatus, next: OrderStatus): boolean {
    const allowed = this.validTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid order state transition from ${current} to ${next}`,
      );
    }
    return true;
  }

  getMilestones(currentStatus: OrderStatus) {
    const timeline = [
      { id: 1, title: 'Order Placed', description: 'Confirmed by customer', status: 'completed', icon: 'shopping_bag' },
      { id: 2, title: 'Vendor Accepted', description: 'Store accepted order', status: 'pending', icon: 'storefront' },
      { id: 3, title: 'Preparing', description: 'Quality check & gift packaging', status: 'pending', icon: 'package_2' },
      { id: 4, title: 'Ready for Pickup', description: 'Packed at store counter', status: 'pending', icon: 'inventory_2' },
      { id: 5, title: 'Rider Assigned', description: 'Assigned to delivery partner', status: 'pending', icon: 'person_pin_circle' },
      { id: 6, title: 'Picked Up', description: 'Rider collected item', status: 'pending', icon: 'moped' },
      { id: 7, title: 'Out for Delivery', description: 'Express delivery in progress', status: 'pending', icon: 'local_shipping' },
      { id: 8, title: 'Delivered', description: 'Handed to customer', status: 'pending', icon: 'verified' },
    ];

    const orderMap: Record<OrderStatus, number> = {
      PLACED: 1,
      ACCEPTED: 2,
      PREPARING: 3,
      READY_FOR_PICKUP: 4,
      ASSIGNED: 5,
      PICKED_UP: 6,
      OUT_FOR_DELIVERY: 7,
      DELIVERED: 8,
    };

    const activeIndex = orderMap[currentStatus] || 1;

    return timeline.map((item) => {
      if (item.id < activeIndex) {
        return { ...item, status: 'completed' as const, time: 'Completed' };
      }
      if (item.id === activeIndex) {
        return { ...item, status: 'active' as const, time: 'In Progress' };
      }
      return { ...item, status: 'pending' as const, time: 'Upcoming' };
    });
  }
}
