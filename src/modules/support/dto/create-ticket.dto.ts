import { IsNotEmpty, IsString, IsOptional, IsIn } from 'class-validator';

export const SUPPORT_TICKET_PRIORITIES = [
  'LOW',
  'NORMAL',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const;

export class CreateTicketDto {
  @IsNotEmpty({ message: 'Ticket title/subject is required' })
  @IsString()
  title: string;

  @IsNotEmpty({ message: 'Category is required' })
  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(SUPPORT_TICKET_PRIORITIES, {
    message: 'Priority must be one of LOW, NORMAL, MEDIUM, HIGH, URGENT',
  })
  priority?: 'LOW' | 'NORMAL' | 'MEDIUM' | 'HIGH' | 'URGENT';
}
