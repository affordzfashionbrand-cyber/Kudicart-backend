import { IsNotEmpty, IsIn, IsOptional, IsString, IsInt } from 'class-validator';
import {
  CANONICAL_ORDER_STATUSES,
  OrderStatus,
} from '../../../common/contracts/order-contracts';

export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'status is required' })
  @IsIn([...CANONICAL_ORDER_STATUSES])
  status: OrderStatus;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}
