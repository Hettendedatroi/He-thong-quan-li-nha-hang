import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import {
  AvailabilityQueryDto,
  CancelReservationDto,
  CheckInByCodeDto,
  ConfirmReservationDto,
  CreateReservationDto,
  DepositDto,
  GuestLookupQueryDto,
  ListReservationsQueryDto,
  MockPaymentConfirmDto,
  RejectReservationDto,
  StaffUpdateReservationDto,
  UpdateReservationDto,
} from './dto/reservations.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('Public - Đặt bàn')
@Public()
@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** FR-02: kiểm tra bàn trống + gợi ý thay thế */
  @Get('availability')
  availability(@Query() q: AvailabilityQueryDto) {
    return this.reservations.checkAvailability(q);
  }

  /** FR-01, FR-03, FR-06: đặt bàn (khách vãng lai hoặc đã đăng nhập) */
  @Post()
  create(@Body() dto: CreateReservationDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.create(dto, user);
  }

  /** FR-05: xem đặt bàn */
  @Get(':code')
  get(@Param('code') code: string, @Query() q: GuestLookupQueryDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.getForGuest(code, q.phone, user);
  }

  /** FR-06: mã QR check-in */
  @Get(':code/qr')
  qr(@Param('code') code: string, @Query() q: GuestLookupQueryDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.qrForGuest(code, q.phone, user);
  }

  /** FR-05: sửa đặt bàn */
  @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateReservationDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.updateByGuest(code, dto, user);
  }

  /** FR-05: hủy đặt bàn */
  @Post(':code/cancel')
  cancel(@Param('code') code: string, @Body() dto: CancelReservationDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.cancelByGuest(code, dto, user);
  }

  /** FR-04: thanh toán cọc online */
  @Post(':code/deposit')
  deposit(@Param('code') code: string, @Body() dto: DepositDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.initDeposit(code, dto, user);
  }
}

@ApiTags('Public - Cổng thanh toán giả lập')
@Public()
@Controller('public/payments/mock')
export class MockPaymentController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.reservations.getMockPayment(id);
  }

  /** Giả lập cổng thanh toán gọi callback về hệ thống */
  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: MockPaymentConfirmDto) {
    return this.reservations.confirmMockPayment(id, dto.success);
  }
}

@ApiTags('Phục vụ - Đặt bàn')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: ListReservationsQueryDto) {
    return this.reservations.list(user, q);
  }

  /** Nhân viên đặt bàn hộ (khách gọi điện) */
  @Post()
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservations.create(dto, user);
  }

  /** FR-WAT-09: check-in bằng mã quét từ QR */
  @Post('check-in')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  checkInByCode(@CurrentUser() user: AuthUser, @Body() dto: CheckInByCodeDto) {
    return this.reservations.checkIn(user, { code: dto.code });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StaffUpdateReservationDto) {
    return this.reservations.staffUpdate(user, id, dto);
  }

  /** FR-WAT-08 */
  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmReservationDto) {
    return this.reservations.confirm(user, id, dto.tableId);
  }

  /** FR-WAT-08 */
  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectReservationDto) {
    return this.reservations.reject(user, id, dto.reason);
  }

  /** FR-WAT-09: check-in thủ công */
  @Post(':id/check-in')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  checkIn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.checkIn(user, { id });
  }

  @Post(':id/no-show')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  noShow(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservations.markNoShow(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.RESERVATION_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelReservationDto) {
    return this.reservations.staffCancel(user, id, dto.reason);
  }
}
