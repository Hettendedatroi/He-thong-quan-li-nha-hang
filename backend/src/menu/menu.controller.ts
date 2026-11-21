import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import {
  CreateCategoryDto,
  CreateComboDto,
  CreateHolidayDto,
  CreateMenuItemDto,
  CreatePriceRuleDto,
  HighlightsQueryDto,
  LangQueryDto,
  ListMenuItemsQueryDto,
  SetAvailabilityDto,
  SetVisibilityDto,
  UpdateCategoryDto,
  UpdateComboDto,
  UpdateMenuItemDto,
  UpdatePriceRuleDto,
} from './dto/menu.dto';
import { MenuService } from './menu.service';
import { PublicMenuService } from './public-menu.service';

@ApiTags('Public - Thực đơn')
@Public()
@Controller('public/menu')
export class PublicMenuController {
  constructor(private readonly menu: PublicMenuService) {}

  /** FR-08: menu theo danh mục (+ combo) */
  @Get()
  get(@Query() q: LangQueryDto) {
    return this.menu.menu(q.lang, q.branchId);
  }

  /** FR-09: món bán chạy / mới / đánh giá cao */
  @Get('highlights')
  highlights(@Query() q: HighlightsQueryDto) {
    return this.menu.highlights(q.lang, q.limit, q.branchId);
  }

  /** FR-09: chi tiết món kèm đánh giá của khách khác */
  @Get('items/:id')
  item(@Param('id', ParseIntPipe) id: number, @Query() q: LangQueryDto) {
    return this.menu.item(id, q.lang);
  }
}

@ApiTags('Quản lý - Thực đơn')
@ApiBearerAuth()
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  // ---------------- Danh mục (FR-MGR-07)
  @Get('categories')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE, PERMISSIONS.MENU_STOCK, PERMISSIONS.ORDER_CREATE)
  listCategories() {
    return this.menu.listCategories();
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.menu.createCategory(user.id, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.menu.updateCategory(user.id, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  deleteCategory(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.menu.deleteCategory(user.id, id);
  }

  // ---------------- Món (FR-MGR-06)
  @Get('items')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE, PERMISSIONS.MENU_STOCK, PERMISSIONS.ORDER_CREATE)
  listItems(@Query() q: ListMenuItemsQueryDto) {
    return this.menu.listItems(q);
  }

  @Get('items/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE, PERMISSIONS.MENU_STOCK, PERMISSIONS.ORDER_CREATE)
  getItem(@Param('id', ParseIntPipe) id: number) {
    return this.menu.getItem(id);
  }

  @Post('items')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  createItem(@CurrentUser() user: AuthUser, @Body() dto: CreateMenuItemDto) {
    return this.menu.createItem(user.id, dto);
  }

  @Patch('items/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  updateItem(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuItemDto) {
    return this.menu.updateItem(user.id, id, dto);
  }

  @Delete('items/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  deleteItem(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.menu.deleteItem(user.id, id);
  }

  @Post('items/:id/image')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menu.uploadImage(user.id, id, file);
  }

  /** FR-MGR-08: ẩn / hiện món */
  @Patch('items/:id/visibility')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  setVisibility(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetVisibilityDto) {
    return this.menu.setVisibility(user.id, id, dto.isVisible);
  }

  /** FR-KIT-04 / FR-MGR-08: còn hàng / tạm hết - đồng bộ realtime */
  @Patch('items/:id/availability')
  @RequirePermissions(PERMISSIONS.MENU_STOCK, PERMISSIONS.MENU_MANAGE)
  setAvailability(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetAvailabilityDto) {
    return this.menu.setAvailability(user.id, id, dto.isAvailable);
  }

  // ---------------- Giá theo thời gian (FR-MGR-10)
  @Get('items/:id/price-rules')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  listPriceRules(@Param('id', ParseIntPipe) id: number) {
    return this.menu.listPriceRules(id);
  }

  @Post('items/:id/price-rules')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  createPriceRule(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreatePriceRuleDto) {
    return this.menu.createPriceRule(user.id, id, dto);
  }

  @Patch('price-rules/:ruleId')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  updatePriceRule(
    @CurrentUser() user: AuthUser,
    @Param('ruleId', ParseIntPipe) ruleId: number,
    @Body() dto: UpdatePriceRuleDto,
  ) {
    return this.menu.updatePriceRule(user.id, ruleId, dto);
  }

  @Delete('price-rules/:ruleId')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  deletePriceRule(@CurrentUser() user: AuthUser, @Param('ruleId', ParseIntPipe) ruleId: number) {
    return this.menu.deletePriceRule(user.id, ruleId);
  }

  @Get('holidays')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  listHolidays() {
    return this.menu.listHolidays();
  }

  @Post('holidays')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  createHoliday(@CurrentUser() user: AuthUser, @Body() dto: CreateHolidayDto) {
    return this.menu.createHoliday(user.id, dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  deleteHoliday(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.menu.deleteHoliday(user.id, id);
  }

  // ---------------- Combo (FR-MGR-09)
  @Get('combos')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE, PERMISSIONS.ORDER_CREATE)
  listCombos() {
    return this.menu.listCombos();
  }

  @Post('combos')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  createCombo(@CurrentUser() user: AuthUser, @Body() dto: CreateComboDto) {
    return this.menu.createCombo(user.id, dto);
  }

  @Patch('combos/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  updateCombo(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateComboDto) {
    return this.menu.updateCombo(user.id, id, dto);
  }

  @Delete('combos/:id')
  @RequirePermissions(PERMISSIONS.MENU_MANAGE)
  deleteCombo(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.menu.deleteCombo(user.id, id);
  }
}
