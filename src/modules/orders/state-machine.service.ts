import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';

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

  // Role permissions per transition (D-034)
  private readonly transitionRoles: Record<string, Role[]> = {
    'PLACED->ACCEPTED': [Role.VENDOR, Role.ADMIN],
    'ACCEPTED->PREPARING': [Role.VENDOR, Role.ADMIN],
    'PREPARING->READY_FOR_PICKUP': [Role.VENDOR, Role.ADMIN],
    'READY_FOR_PICKUP->ASSIGNED': [Role.ADMIN],
    'ASSIGNED->PICKED_UP': [Role.DRIVER, Role.ADMIN],
    'PICKED_UP->OUT_FOR_DELIVERY': [Role.DRIVER, Role.ADMIN],
    'OUT_FOR_DELIVERY->DELIVERED': [Role.DRIVER, Role.ADMIN],
  };

  validateTransition(current: OrderStatus, next: OrderStatus, actorRole?: Role | string): boolean {
    const allowed = this.validTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid order state transition from ${current} to ${next}. Valid next states: [${allowed.join(', ')}]`,
      );
    }

    if (actorRole) {
      const transitionKey = `${current}->${next}`;
      const permittedRoles = this.transitionRoles[transitionKey];
      if (permittedRoles && !permittedRoles.includes(actorRole as Role)) {
        throw new ForbiddenException(
          `Actor with role '${actorRole}' is not authorized to transition order from ${current} to ${next}. Required role: [${permittedRoles.join(', ')}]`,
        );
      }
    }

    return true;
  }

  getMilestones(currentStatus: OrderStatus) {
    const timeline = [
      { id: 1, key: 'PLACED', title: 'Order Placed', description: 'Confirmed by customer', status: 'completed', icon: 'shopping_bag' },
      { id: 2, key: 'ACCEPTED', title: 'Vendor Accepted', description: 'Boutique accepted order', status: 'pending', icon: 'storefront' },
      { id: 3, key: 'PREPARING', title: 'Preparing', description: 'Quality check & gift packaging', status: 'pending', icon: 'package_2' },
      { id: 4, key: 'READY_FOR_PICKUP', title: 'Ready for Pickup', description: 'Packed at store counter', status: 'pending', icon: 'inventory_2' },
      { id: 5, key: 'ASSIGNED', title: 'Rider Assigned', description: 'Assigned to delivery partner', status: 'pending', icon: 'person_pin_circle' },
      { id: 6, key: 'PICKED_UP', title: 'Picked Up', description: 'Rider collected item from boutique', status: 'pending', icon: 'moped' },
      { id: 7, key: 'OUT_FOR_DELIVERY', title: 'Out for Delivery', description: 'Express delivery in progress', status: 'pending', icon: 'local_shipping' },
      { id: 8, key: 'DELIVERED', title: 'Delivered', description: 'Handed to customer', status: 'pending', icon: 'verified' },
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
