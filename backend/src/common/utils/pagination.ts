import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}

export function toSkipTake(page = 1, limit = 20) {
  return { skip: (page - 1) * limit, take: limit };
}

export function paged<T>(items: T[], total: number, page = 1, limit = 20) {
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}
