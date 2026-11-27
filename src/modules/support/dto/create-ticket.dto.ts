import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  IsNumber,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SUPPORT_TICKET_PRIORITIES = [
  'LOW',
  'NORMAL',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const;

export class SupportAttachmentDto {
  @IsNotEmpty()
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  mimeType: string;

  @IsOptional()
  @IsIn(['image', 'video'])
  mediaType?: 'image' | 'video';

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;
}

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'You can attach up to 6 files per ticket' })
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentDto)
  attachments?: SupportAttachmentDto[];
}
