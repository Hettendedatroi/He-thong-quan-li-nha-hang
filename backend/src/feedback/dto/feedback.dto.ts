import { FeedbackStatus, Reaction } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToBoolean } from '../../common/decorators';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class CreateDishReviewDto {
  @IsInt()
  orderItemId: number;

  /** FR-16: chấm 1-5 sao (tùy chọn) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  /** FR-16: LIKE / DISLIKE (tùy chọn) */
  @IsOptional()
  @IsEnum(Reaction)
  reaction?: Reaction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  /** FR-19 */
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}

export class CreateFeedbackDto {
  @IsInt()
  billId: number;

  /** FR-17: điểm tổng thể 1-5 */
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  foodRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  serviceRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ambienceRating?: number;

  /** FR-18 */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  /** FR-18: URL ảnh đã upload qua POST /public/sessions/:token/uploads */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  photos?: string[];

  /** FR-19 */
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  /** FR-20: email nhận phản hồi (khách vãng lai) */
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsBoolean()
  wantsResponse?: boolean;
}

export class ListFeedbackQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** FR-MGR-11: lọc theo nhân viên phục vụ */
  @IsOptional()
  @IsInt()
  staffId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsInt()
  minRating?: number;

  @IsOptional()
  @IsInt()
  maxRating?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;
}

export class ListDishReviewsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** FR-MGR-11: lọc theo món */
  @IsOptional()
  @IsInt()
  menuItemId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(Reaction)
  reaction?: Reaction;

  @IsOptional()
  @IsInt()
  minRating?: number;

  @IsOptional()
  @IsInt()
  maxRating?: number;
}

export class LatestFeedbackQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RespondFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  /** FR-MGR-12: công khai (hiện dưới đánh giá) hoặc riêng tư (chỉ gửi cho khách) */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class FlagFeedbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class HideReviewDto {
  @IsBoolean()
  isHidden: boolean;
}
