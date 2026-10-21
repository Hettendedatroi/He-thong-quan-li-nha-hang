import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import {
  CreateServiceRequestDto,
  ListServiceRequestsQueryDto,
  ResolveServiceRequestDto,
} from './service-requests.dto';
import { ServiceRequestsService } from './service-requests.service';

@ApiTags('Public - Yêu cầu phục vụ')
@Public()
@Controller('public/sessions/:token/requests')
export class PublicServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  /** FR-13: gọi nhân viên, xin hóa đơn, đổi / hủy món... */
  @Post()
  create(@Param('token') token: string, @Body() dto: CreateServiceRequestDto) {
    return this.requests.create(token, dto);
  }

  @Get()
  list(@Param('token') token: string) {
    return this.requests.listForSession(token);
  }

  @Post(':id/cancel')
  cancel(@Param('token') token: string, @Param('id', ParseIntPipe) id: number) {
    return this.requests.cancelByCustomer(token, id);
  }
}

@ApiTags('Phục vụ - Yêu cầu của khách')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  /** FR-WAT-04 */
  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_REQUEST_HANDLE)
  list(@CurrentUser() user: AuthUser, @Query() q: ListServiceRequestsQueryDto) {
    return this.requests.list(user, q);
  }

  @Post(':id/acknowledge')
  @RequirePermissions(PERMISSIONS.SERVICE_REQUEST_HANDLE)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.acknowledge(user, id);
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.SERVICE_REQUEST_HANDLE)
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResolveServiceRequestDto) {
    return this.requests.resolve(user, id, dto.response);
  }
}
