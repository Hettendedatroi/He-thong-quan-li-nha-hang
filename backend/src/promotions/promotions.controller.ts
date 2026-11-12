import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { CreatePromotionDto, ListPromotionsQueryDto, UpdatePromotionDto } from './dto/promotions.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('Quản lý - Khuyến mãi')
@ApiBearerAuth()
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROMOTION_MANAGE, PERMISSIONS.BILL_MANAGE)
  list(@Query() q: ListPromotionsQueryDto) {
    return this.promotions.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROMOTION_MANAGE, PERMISSIONS.BILL_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.promotions.get(id);
  }

  /** FR-MGR-09: tạo happy hour / voucher */
  @Post()
  @RequirePermissions(PERMISSIONS.PROMOTION_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromotionDto) {
    return this.promotions.create(user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROMOTION_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PROMOTION_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.promotions.remove(user.id, id);
  }
}

@ApiTags('Public - Khuyến mãi')
@Public()
@Controller('public/promotions')
export class PublicPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  /** Khuyến mãi đang chạy để hiển thị trên menu */
  @Get()
  async active(@Query() q: ListPromotionsQueryDto) {
    const list = await this.promotions.list({ activeOnly: true, branchId: q.branchId });
    return list
      .filter((p) => p.usageLimit == null || p.usedCount < p.usageLimit)
      .map((p) => {
        const { usedCount: _u, usageLimit: _l, ...rest } = p;
        return { ...rest, isHappeningNow: this.promotions.isApplicableNow(p) };
      });
  }
}
