import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateTicketDto {
  @IsNotEmpty({ message: 'Ticket title / issue summary is required' })
  @IsString()
  title: string;

  @IsNotEmpty({ message: 'Category is required (e.g. Delivery, Order Issue, Quality)' })
  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
