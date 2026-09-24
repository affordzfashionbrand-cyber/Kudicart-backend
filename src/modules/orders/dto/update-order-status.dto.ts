import { IsNotEmpty, IsIn, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '../state-machine.service';

export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'status is required' })
  @IsIn([
    'PLACED',
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'ASSIGNED',
    'PICKED_UP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ])
  status: OrderStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
