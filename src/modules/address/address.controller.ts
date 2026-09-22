import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AddressService } from './address.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/addresses')
@UseGuards(FirebaseAuthGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  async getAddresses() {
    return this.addressService.getAddresses('usr-1');
  }

  @Post()
  async addAddress(@Body() body: any) {
    return this.addressService.addAddress('usr-1', body);
  }
}
