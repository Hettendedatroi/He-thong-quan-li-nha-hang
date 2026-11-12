import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { BillsService } from './bills.service';
import { GenerateBillDto, ListBillsQueryDto, PayBillDto, RefundBillDto, SplitBillDto, VoidBillDto } from './dto/billing.dto';

@ApiTags('Phục vụ - Hóa đơn & Thanh toán')
@ApiBearerAuth()
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  /** FR-WAT-13: tạo hóa đơn cuối (gọi lại để áp voucher / điểm / giảm giá mới) */
  @Post()
  @RequirePermissions(PERMISSIONS.BILL_MANAGE)
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateBillDto) {
    return this.bills.generate(user, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BILL_MANAGE, PERMISSIONS.REPORT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: ListBillsQueryDto) {
    return this.bills.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILL_MANAGE, PERMISSIONS.REPORT_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bills.get(user, id);
  }

  /** FR-WAT-13: tách hóa đơn */
  @Post(':id/split')
  @RequirePermissions(PERMISSIONS.BILL_MANAGE)
  split(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SplitBillDto) {
    return this.bills.split(user, id, dto);
  }

  /** FR-WAT-14: xác nhận thanh toán */
  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.PAYMENT_CONFIRM)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PayBillDto) {
    return this.bills.pay(user, id, dto);
  }

  /** FR-WAT-16: hủy hóa đơn */
  @Post(':id/void')
  @RequirePermissions(PERMISSIONS.BILL_VOID)
  void(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VoidBillDto) {
    return this.bills.void(user, id, dto.reason);
  }

  /** FR-WAT-16: hoàn tiền */
  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.BILL_REFUND)
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RefundBillDto) {
    return this.bills.refund(user, id, dto);
  }
}

@ApiTags('Public - Hóa đơn của bàn')
@Public()
@Controller('public/sessions/:token/bills')
export class PublicBillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(@Param('token') token: string) {
    return this.bills.forSession(token);
  }
}
