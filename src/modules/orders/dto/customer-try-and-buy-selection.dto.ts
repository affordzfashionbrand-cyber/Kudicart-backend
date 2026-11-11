import { IsNotEmpty, IsObject } from 'class-validator';

export class CustomerTryAndBuySelectionDto {
  @IsNotEmpty({ message: 'Selections map is required' })
  @IsObject()
  selections: Record<string, 'KEEP' | 'RETURN'>;
}
