import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import {
  OrderStatus,
  VALID_ORDER_TRANSITIONS,
  ORDER_TRANSITION_ROLES,
} from '../../common/contracts/order-contracts';

export { OrderStatus };

@Injectable()
export class StateMachineService {
  private readonly validTransitions: Record<OrderStatus, readonly OrderStatus[]> =
    VALID_ORDER_TRANSITIONS;

  private readonly transitionRoles: Record<string, readonly string[]> =
    ORDER_TRANSITION_ROLES;

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
      if (permittedRoles && !permittedRoles.includes(String(actorRole))) {
        throw new ForbiddenException(
          `Actor with role '${actorRole}' is not authorized to transition order from ${current} to ${next}. Required role: [${permittedRoles.join(', ')}]`,
        );
      }
    } else {
      throw new ForbiddenException(`Actor role is required to transition order from ${current} to ${next}`);
    }

    return true;
  }

  getMilestones(currentStatus: OrderStatus) {
    const timeline = [
      { id: 1, key: 'PLACED', title: 'Order Placed', description: 'Confirmed by customer', icon: 'shopping_bag' },
      { id: 2, key: 'ACCEPTED', title: 'Vendor Accepted', description: 'Boutique accepted order', icon: 'storefront' },
      { id: 3, key: 'PREPARING', title: 'Preparing', description: 'Quality check & packaging', icon: 'package_2' },
      { id: 4, key: 'READY_FOR_PICKUP', title: 'Ready for Pickup', description: 'Packed at store counter', icon: 'inventory_2' },
      { id: 5, key: 'ASSIGNED', title: 'Rider Assigned', description: 'Assigned to delivery partner', icon: 'person_pin_circle' },
      { id: 6, key: 'PICKED_UP', title: 'Picked Up', description: 'Rider collected item from boutique', icon: 'moped' },
      { id: 7, key: 'OUT_FOR_DELIVERY', title: 'Out for Delivery', description: 'Express delivery in progress', icon: 'local_shipping' },
      { id: 8, key: 'DELIVERED', title: 'Delivered', description: 'Handed to customer', icon: 'verified' },
    ];

    if (currentStatus === 'RETURNING' || currentStatus === 'RETURNED') {
      timeline.push({
        id: 9,
        key: currentStatus,
        title: currentStatus === 'RETURNING' ? 'Returning to Hub' : 'Returned & Reconciled',
        description:
          currentStatus === 'RETURNING'
            ? 'Rider returning Try & Buy items to dark store'
            : 'Returned items inspected and reconciled',
        icon: 'assignment_return',
      });
    }

    if (currentStatus === 'CANCELLED' || currentStatus === 'FAILED') {
      return timeline.map((item) => ({
        ...item,
        status: item.id === 1 ? ('completed' as const) : ('pending' as const),
        time: item.id === 1 ? 'Completed' : currentStatus === 'CANCELLED' ? 'Cancelled' : 'Failed',
      }));
    }

    const orderMap: Record<OrderStatus, number> = {
      CANCELLED: 0,
      FAILED: 0,
      PLACED: 1,
      ACCEPTED: 2,
      PREPARING: 3,
      READY_FOR_PICKUP: 4,
      ASSIGNED: 5,
      PICKED_UP: 6,
      OUT_FOR_DELIVERY: 7,
      DELIVERED: 8,
      RETURNING: 9,
      RETURNED: 9,
    };

    const activeIndex = orderMap[currentStatus] || 1;

    return timeline.map((item) => {
      if (currentStatus === 'DELIVERED' || currentStatus === 'RETURNED') {
        return { ...item, status: 'completed' as const, time: 'Completed' };
      }
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
