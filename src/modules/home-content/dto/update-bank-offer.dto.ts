import { PartialType } from '@nestjs/swagger';
import { CreateBankOfferDto } from './create-bank-offer.dto';

export class UpdateBankOfferDto extends PartialType(CreateBankOfferDto) {}
