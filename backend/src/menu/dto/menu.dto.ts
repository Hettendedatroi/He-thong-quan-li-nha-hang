import { ApiProperty, PartialType } from '@nestjs/swagger';
import { DayType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ToBoolean } from '../../common/decorators';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class LangQueryDto {
  /** Ngôn ngữ hiển thị (FR-ADM-10), vd: vi, en */
  @IsOptional()
  @IsString()
  lang?: string;

  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class HighlightsQueryDto extends LangQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** {"en": {"name": "Appetizers", "description": "..."}} */
  @IsOptional()
  @IsObject()
  translations?: Record<string, { name?: string; description?: string }>;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CreateMenuItemDto {
  @IsInt()
  categoryId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  /** FR-MGR-06: thời gian chế biến dự kiến (phút) */
  @IsOptional()
  @IsInt()
  @Min(1)
  prepTimeMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  translations?: Record<string, { name?: string; description?: string }>;
}

export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

export class ListMenuItemsQueryDto {
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isVisible?: boolean;
}

export class SetVisibilityDto {
  @IsBoolean()
  isVisible: boolean;
}

export class SetAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

export class ComboItemDto {
  @IsInt()
  menuItemId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CreateComboDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  translations?: Record<string, { name?: string; description?: string }>;

  // Khai báo type tường minh: tránh lỗi plugin Swagger sinh đường dẫn tuyệt đối khi thư mục project có dấu
  @ApiProperty({ type: () => ComboItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComboItemDto)
  items: ComboItemDto[];
}

export class UpdateComboDto extends PartialType(CreateComboDto) {}

export class CreatePriceRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DayType)
  dayType: DayType;

  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePriceRuleDto extends PartialType(CreatePriceRuleDto) {}

export class CreateHolidayDto {
  /** YYYY-MM-DD */
  @IsDateString()
  date: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
