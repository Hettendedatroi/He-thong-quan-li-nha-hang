import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import {
  CreateDishReviewDto,
  CreateFeedbackDto,
  FlagFeedbackDto,
  HideReviewDto,
  LatestFeedbackQueryDto,
  ListDishReviewsQueryDto,
  ListFeedbackQueryDto,
  RespondFeedbackDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('Public - Đánh giá')
@Public()
@Controller('public/sessions/:token')
export class PublicFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** FR-16: đánh giá món */
  @Post('dish-reviews')
  createDishReview(@Param('token') token: string, @Body() dto: CreateDishReviewDto, @CurrentUser() user?: AuthUser) {
    return this.feedback.createDishReview(token, dto, user);
  }

  /** FR-17..FR-19: đánh giá trải nghiệm theo hóa đơn */
  @Post('feedback')
  createFeedback(@Param('token') token: string, @Body() dto: CreateFeedbackDto, @CurrentUser() user?: AuthUser) {
    return this.feedback.createFeedback(token, dto, user);
  }

  @Get('feedback')
  submitted(@Param('token') token: string) {
    return this.feedback.forSession(token);
  }
}

@ApiTags('Quản lý - Đánh giá & Khiếu nại')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** FR-MGR-11, FR-ADM-12 */
  @Get()
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW, PERMISSIONS.FEEDBACK_RESPOND)
  list(@CurrentUser() user: AuthUser, @Query() q: ListFeedbackQueryDto) {
    return this.feedback.list(user, q);
  }

  /** FR-WAT-05 */
  @Get('latest')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW, PERMISSIONS.FEEDBACK_RESPOND)
  latest(@CurrentUser() user: AuthUser, @Query() q: LatestFeedbackQueryDto) {
    return this.feedback.latest(user, q.branchId, q.limit);
  }

  @Get('dish-reviews')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW, PERMISSIONS.FEEDBACK_RESPOND)
  dishReviews(@CurrentUser() user: AuthUser, @Query() q: ListDishReviewsQueryDto) {
    return this.feedback.listDishReviews(user, q);
  }

  @Post('dish-reviews/:id/respond')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  respondDishReview(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RespondFeedbackDto) {
    return this.feedback.respondDishReview(user, id, dto);
  }

  @Patch('dish-reviews/:id/visibility')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  hideDishReview(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HideReviewDto) {
    return this.feedback.setDishReviewHidden(user, id, dto.isHidden);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW, PERMISSIONS.FEEDBACK_RESPOND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.feedback.get(user, id);
  }

  /** FR-MGR-12 */
  @Post(':id/respond')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  respond(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RespondFeedbackDto) {
    return this.feedback.respond(user, id, dto);
  }

  /** FR-MGR-13 */
  @Post(':id/flag')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  flag(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: FlagFeedbackDto) {
    return this.feedback.flag(user, id, true, dto.note);
  }

  @Post(':id/unflag')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  unflag(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.feedback.flag(user, id, false);
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.FEEDBACK_RESPOND)
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: FlagFeedbackDto) {
    return this.feedback.resolve(user, id, dto.note);
  }
}
