import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
  IsNumber,
} from 'class-validator';

export class TryAndBuyHandoverDto {
  @IsNotEmpty({ message: 'Customer verification OTP or confirmation code is required' })
  @IsString()
  otp: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  handoverImages?: string[];
}

export class TryAndBuySelectionsDto {
  @IsNotEmpty({ message: 'Selections map is required' })
  @IsObject()
  selections: Record<string, 'KEEP' | 'RETURN'>;
}

export class TryAndBuyReturnCollectionDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  returnImages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectedItemIds?: string[];
}

export class TryAndBuySettlePaymentDto {
  @IsOptional()
  @IsBoolean()
  cashCollected?: boolean;

  @IsOptional()
  @IsNumber()
  amountCollected?: number;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class TryAndBuyReconciliationDto {
  @IsNotEmpty({ message: 'Store supervisor confirmation is required' })
  @IsBoolean()
  supervisorConfirmed: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
