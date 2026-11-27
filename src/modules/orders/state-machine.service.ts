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

  getMilestones(
    currentStatus: OrderStatus,
    options?: { isTryAndBuy?: boolean },
  ) {
    const isTryAndBuy = Boolean(options?.isTryAndBuy || currentStatus === 'TRY_AND_BUY');

    const timeline = [
      { id: 1, key: 'PLACED', title: 'Order Placed', description: 'Order confirmed and awaiting acceptance', icon: 'shopping_bag' },
      { id: 2, key: 'PACKING', title: 'Order is getting packed', description: 'Accepted by store and items are being packed', icon: 'package_2' },
      { id: 3, key: 'READY_FOR_PICKUP', title: 'Ready for Pickup', description: 'Packed and waiting for rider collection', icon: 'inventory_2' },
      { id: 4, key: 'OUT_FOR_DELIVERY', title: 'Out for Delivery', description: 'Picked up by delivery partner', icon: 'local_shipping' },
    ];

    if (isTryAndBuy) {
      timeline.push({
        id: 5,
        key: 'TRY_AND_BUY',
        title: 'Try & Buy',
        description: '10-minute doorstep trial in progress',
        icon: 'checkroom',
      });
    }

    if (currentStatus === 'RETURNING' || currentStatus === 'RETURNED') {
      timeline.push({
        id: isTryAndBuy ? 6 : 5,
        key: currentStatus,
        title: 'Order Return',
        description:
          currentStatus === 'RETURNING'
            ? 'Returning items to store hub'
            : 'Order returned and reconciled',
        icon: 'assignment_return',
      });
    } else {
      timeline.push({
        id: isTryAndBuy ? 6 : 5,
        key: 'DELIVERED',
        title: 'Order Delivered',
        description: 'Handed over to customer',
        icon: 'verified',
      });
    }

    if (currentStatus === 'CANCELLED' || currentStatus === 'FAILED') {
      return timeline.map((item) => ({
        ...item,
        status: item.id === 1 ? ('completed' as const) : ('pending' as const),
        time: item.id === 1 ? 'Completed' : currentStatus === 'CANCELLED' ? 'Cancelled' : 'Failed',
      }));
    }

    const activeStepByStatus: Record<OrderStatus, number> = {
      CANCELLED: 0,
      FAILED: 0,
      PLACED: 1,
      ACCEPTED: 2,
      PACKING: 2,
      PREPARING: 2,
      READY_FOR_PICKUP: 3,
      ASSIGNED: 3, // Legacy compatibility: assigned partner does NOT show Out for Delivery
      PICKED_UP: 4,
      OUT_FOR_DELIVERY: 4,
      TRY_AND_BUY: 5,
      DELIVERED: isTryAndBuy ? 6 : 5,
      RETURNING: isTryAndBuy ? 6 : 5,
      RETURNED: isTryAndBuy ? 6 : 5,
    };

    const activeIndex = activeStepByStatus[currentStatus] || 1;

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
