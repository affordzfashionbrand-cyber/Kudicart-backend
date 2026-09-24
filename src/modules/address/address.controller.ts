import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/addresses')
@UseGuards(FirebaseAuthGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  async getAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.addressService.getAddresses(user.id);
  }

  @Get(':id')
  async getAddressById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.addressService.getAddressById(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddressDto,
  ) {
    return this.addressService.addAddress(user.id, body);
  }

  @Patch(':id')
  async updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateAddressDto,
  ) {
    return this.addressService.updateAddress(user.id, id, body);
  }

  @Patch(':id/default')
  async setDefaultAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.addressService.setDefaultAddress(user.id, id);
  }

  @Delete(':id')
  async deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.addressService.deleteAddress(user.id, id);
  }
}
