import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class BookSlotDto {
  @IsNotEmpty({ message: 'Slot ID is required' })
  @IsString()
  slotId: string;

  @IsOptional()
  @IsString()
  dateKey?: string;
}

export class CancelSlotDto {
  @IsNotEmpty({ message: 'Slot ID is required' })
  @IsString()
  slotId: string;
}
