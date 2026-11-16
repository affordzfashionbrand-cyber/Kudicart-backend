import { Controller, Get, Query } from '@nestjs/common';
import { HomeContentService } from './home-content.service';

@Controller('api/v1/home')
export class HomeContentController {
  constructor(private readonly homeContentService: HomeContentService) {}

  @Get('layout')
  async getLayout(@Query('gender') gender?: string) {
    return this.homeContentService.getPublicLayout(gender);
  }
}
