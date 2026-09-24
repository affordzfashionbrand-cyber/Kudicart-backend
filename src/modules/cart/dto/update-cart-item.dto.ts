import { IsInt, IsNotEmpty } from 'class-validator';

export class UpdateCartItemDto {
  @IsNotEmpty()
  @IsInt()
  delta: number;
}
