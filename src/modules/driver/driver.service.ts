import { Injectable } from '@nestjs/common';
import { DriverProfileService } from './driver-profile.service';
import { DriverOrdersService } from './driver-orders.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { OrderPickupDto, OrderDeliverDto } from './dto/order-action.dto';

@Injectable()
export class DriverService {
  constructor(
    private profileService: DriverProfileService,
    private ordersService: DriverOrdersService,
  ) {}

  async getProfile(driverId?: string) {
    return this.profileService.getProfile(driverId);
  }

  async updateProfile(driverId: string | undefined, dto: UpdateDriverProfileDto) {
    return this.profileService.updateDetails(driverId, dto);
  }

  async getKycStatus(driverId?: string) {
    return this.profileService.getKycStatus(driverId);
  }

  async updateAvailability(driverId: string | undefined, isOnline: boolean) {
    return this.profileService.updateAvailability(driverId, isOnline);
  }

  async getAssignedOrders(driverId?: string, statusFilter?: string) {
    return this.ordersService.getAssignedOrders(driverId, statusFilter);
  }

  async getOrderDetails(driverId: string | undefined, orderId: string) {
    return this.ordersService.getOrderDetails(driverId, orderId);
  }

  async acceptOrder(driverId: string | undefined, orderId: string) {
    return this.ordersService.acceptOrder(driverId, orderId);
  }

  async pickupOrder(driverId: string | undefined, orderId: string, dto?: OrderPickupDto) {
    return this.ordersService.pickupOrder(driverId, orderId, dto);
  }

  async outForDeliveryOrder(driverId: string | undefined, orderId: string) {
    return this.ordersService.outForDelivery(driverId, orderId);
  }

  async deliverOrder(driverId: string | undefined, orderId: string, dto?: OrderDeliverDto) {
    return this.ordersService.deliverOrder(driverId, orderId, dto);
  }

  async updateLocation(driverId: string | undefined, dto: UpdateLocationDto) {
    return this.profileService.updateLocation(driverId, dto);
  }
}
