import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-user';
import { assertBranchAccess, scopeBranch } from '../common/utils/branch-scope';
import { paged, toSkipTake } from '../common/utils/pagination';
import { addDays, parseDateRange } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import {
  CreateDishReviewDto,
  CreateFeedbackDto,
  ListDishReviewsQueryDto,
  ListFeedbackQueryDto,
  RespondFeedbackDto,
} from './dto/feedback.dto';

/** Khách được đánh giá trong vòng N ngày sau bữa ăn */
const REVIEW_WINDOW_DAYS = 7;

const FEEDBACK_INCLUDE = {
  bill: { select: { id: true, code: true, total: true, paidAt: true, table: { select: { code: true } } } },
  customer: { select: { id: true, fullName: true, phone: true } },
  staff: { select: { id: true, fullName: true } },
  responses: { include: { responder: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FeedbackInclude;

const REVIEW_INCLUDE = {
  menuItem: { select: { id: true, name: true } },
  customer: { select: { id: true, fullName: true } },
  session: { select: { branchId: true, table: { select: { code: true } } } },
  responses: { include: { responder: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DishReviewInclude;

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TableSessionsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================== KHÁCH HÀNG

  /** FR-16: đánh giá từng món đã gọi */
  async createDishReview(token: string, dto: CreateDishReviewDto, user?: AuthUser) {
    const session = await this.getReviewableSession(token);
    if (dto.rating == null && !dto.reaction) throw new BadRequestException('Hãy chấm sao hoặc chọn thích / không thích');
    const item = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId, order: { sessionId: session.id } },
    });
    if (!item) throw new BadRequestException('Món không thuộc bàn của bạn');
    if (!item.menuItemId) throw new BadRequestException('Chỉ đánh giá được món lẻ');
    if (item.status === 'CANCELLED') throw new BadRequestException('Món đã hủy');
    const exists = await this.prisma.dishReview.findUnique({ where: { orderItemId: item.id } });
    if (exists) throw new ConflictException('Bạn đã đánh giá món này');

    const review = await this.prisma.dishReview.create({
      data: {
        menuItemId: item.menuItemId,
        orderItemId: item.id,
        sessionId: session.id,
        customerId: dto.isAnonymous ? null : (user?.id ?? session.customerId),
        rating: dto.rating,
        reaction: dto.reaction,
        comment: dto.comment,
        isAnonymous: !!dto.isAnonymous,
      },
      include: REVIEW_INCLUDE,
    });
    this.realtime.toBranchStaff(session.branchId, 'feedback.dish-review', review);
    return review;
  }

  /** FR-17..FR-19: đánh giá trải nghiệm theo hóa đơn - mỗi hóa đơn chỉ 1 lần, khóa sau khi gửi */
  async createFeedback(token: string, dto: CreateFeedbackDto, user?: AuthUser) {
    const session = await this.getReviewableSession(token);
    const bill = await this.prisma.bill.findFirst({ where: { id: dto.billId, sessionId: session.id } });
    if (!bill) throw new BadRequestException('Hóa đơn không thuộc bàn của bạn');
    if (bill.parentBillId) throw new BadRequestException('Vui lòng đánh giá trên hóa đơn gốc');
    if (bill.status !== 'PAID' && bill.status !== 'REFUNDED') throw new BadRequestException('Chỉ đánh giá sau khi thanh toán');
    const existed = await this.prisma.feedback.findUnique({ where: { billId: bill.id } });
    if (existed) throw new ConflictException('Hóa đơn này đã được đánh giá và đã khóa');

    const lowRating = dto.rating <= 2;
    const feedback = await this.prisma.feedback.create({
      data: {
        billId: bill.id,
        branchId: bill.branchId,
        customerId: dto.isAnonymous ? null : (user?.id ?? bill.customerId ?? session.customerId),
        staffId: bill.createdById,
        isAnonymous: !!dto.isAnonymous,
        rating: dto.rating,
        foodRating: dto.foodRating,
        serviceRating: dto.serviceRating,
        ambienceRating: dto.ambienceRating,
        comment: dto.comment,
        photos: dto.photos ?? [],
        contactEmail: dto.contactEmail,
        wantsResponse: dto.wantsResponse ?? !!dto.contactEmail,
        // Đánh giá thấp tự gắn cờ để quản lý theo dõi (FR-MGR-13)
        ...(lowRating ? { isFlagged: true, status: 'FLAGGED', flagNote: 'Tự động: đánh giá thấp' } : {}),
      },
      include: FEEDBACK_INCLUDE,
    });
    this.realtime.toBranchStaff(bill.branchId, 'feedback.created', this.presentFeedback(feedback));
    return this.presentFeedback(feedback);
  }

  /** Đánh giá đã gửi trong phiên (để giao diện khóa nút đánh giá) */
  async forSession(token: string) {
    const session = await this.sessions.getByToken(token, false);
    const [dishReviews, feedback] = await Promise.all([
      this.prisma.dishReview.findMany({ where: { sessionId: session.id }, select: { id: true, orderItemId: true, rating: true, reaction: true } }),
      this.prisma.feedback.findMany({
        where: { bill: { sessionId: session.id } },
        include: { responses: { where: { isPublic: true }, select: { message: true, createdAt: true } } },
      }),
    ]);
    return { dishReviews, feedback };
  }

  // =========================================================== NHÂN VIÊN / QUẢN LÝ

  /** FR-MGR-11, FR-ADM-12: danh sách đánh giá trải nghiệm, lọc theo chi nhánh / nhân viên / thời gian */
  async list(user: AuthUser, q: ListFeedbackQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.FeedbackWhereInput = {
      ...(branchId ? { branchId } : {}),
      ...(q.staffId ? { staffId: q.staffId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.flagged !== undefined ? { isFlagged: q.flagged } : {}),
      ...(q.minRating || q.maxRating ? { rating: { gte: q.minRating ?? 1, lte: q.maxRating ?? 5 } } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total, agg] = await Promise.all([
      this.prisma.feedback.findMany({ where, include: FEEDBACK_INCLUDE, orderBy: { createdAt: 'desc' }, ...toSkipTake(q.page, q.limit) }),
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.aggregate({ where, _avg: { rating: true, foodRating: true, serviceRating: true, ambienceRating: true } }),
    ]);
    return { ...paged(items.map((f) => this.presentFeedback(f)), total, q.page, q.limit), averages: agg._avg };
  }

  /** FR-MGR-11: đánh giá món, lọc theo món / thời gian */
  async listDishReviews(user: AuthUser, q: ListDishReviewsQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.DishReviewWhereInput = {
      ...(branchId ? { session: { branchId } } : {}),
      ...(q.menuItemId ? { menuItemId: q.menuItemId } : {}),
      ...(q.reaction ? { reaction: q.reaction } : {}),
      ...(q.minRating || q.maxRating ? { rating: { gte: q.minRating ?? 1, lte: q.maxRating ?? 5 } } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dishReview.findMany({ where, include: REVIEW_INCLUDE, orderBy: { createdAt: 'desc' }, ...toSkipTake(q.page, q.limit) }),
      this.prisma.dishReview.count({ where }),
    ]);
    return paged(items, total, q.page, q.limit);
  }

  /** FR-WAT-05: đánh giá mới nhất (gộp đánh giá món + trải nghiệm) */
  async latest(user: AuthUser, branchId?: number, limit = 20) {
    const b = scopeBranch(user, branchId);
    const [feedback, reviews] = await Promise.all([
      this.prisma.feedback.findMany({
        where: b ? { branchId: b } : {},
        include: FEEDBACK_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.dishReview.findMany({
        where: b ? { session: { branchId: b } } : {},
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return [
      ...feedback.map((f) => ({ kind: 'EXPERIENCE' as const, createdAt: f.createdAt, data: this.presentFeedback(f) })),
      ...reviews.map((r) => ({ kind: 'DISH' as const, createdAt: r.createdAt, data: r })),
    ]
      .sort((a, b2) => b2.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async get(user: AuthUser, id: number) {
    const f = await this.prisma.feedback.findUnique({ where: { id }, include: FEEDBACK_INCLUDE });
    if (!f) throw new NotFoundException('Không tìm thấy đánh giá');
    assertBranchAccess(user, f.branchId);
    return this.presentFeedback(f);
  }

  /** FR-MGR-12, FR-20: phản hồi đánh giá (công khai / riêng tư) + gửi thông báo cho khách */
  async respond(user: AuthUser, id: number, dto: RespondFeedbackDto) {
    const f = await this.prisma.feedback.findUnique({ where: { id }, include: { customer: true } });
    if (!f) throw new NotFoundException('Không tìm thấy đánh giá');
    assertBranchAccess(user, f.branchId);
    const response = await this.prisma.feedbackResponse.create({
      data: { feedbackId: id, responderId: user.id, message: dto.message, isPublic: dto.isPublic ?? true },
    });
    await this.notifications.notify({
      code: 'FEEDBACK_RESPONSE',
      userId: f.customerId,
      email: f.contactEmail ?? f.customer?.email,
      vars: { message: dto.message },
      data: { feedbackId: id },
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
    });
    await this.audit.log({ userId: user.id, action: 'feedback.respond', entity: 'Feedback', entityId: id });
    return response;
  }

  async respondDishReview(user: AuthUser, id: number, dto: RespondFeedbackDto) {
    const r = await this.prisma.dishReview.findUnique({ where: { id }, include: { session: true } });
    if (!r) throw new NotFoundException('Không tìm thấy đánh giá món');
    if (r.session) assertBranchAccess(user, r.session.branchId);
    const response = await this.prisma.feedbackResponse.create({
      data: { dishReviewId: id, responderId: user.id, message: dto.message, isPublic: dto.isPublic ?? true },
    });
    if (r.customerId) {
      await this.notifications.notify({
        code: 'FEEDBACK_RESPONSE',
        userId: r.customerId,
        vars: { message: dto.message },
        data: { dishReviewId: id },
        channels: ['IN_APP', 'PUSH'],
      });
    }
    return response;
  }

  /** FR-MGR-13: gắn cờ đánh giá tiêu cực để theo dõi */
  async flag(user: AuthUser, id: number, flagged: boolean, note?: string) {
    const f = await this.prisma.feedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Không tìm thấy đánh giá');
    assertBranchAccess(user, f.branchId);
    const updated = await this.prisma.feedback.update({
      where: { id },
      data: flagged
        ? { isFlagged: true, status: 'FLAGGED', flagNote: note, flaggedById: user.id }
        : { isFlagged: false, status: f.status === 'FLAGGED' ? 'NEW' : f.status },
      include: FEEDBACK_INCLUDE,
    });
    await this.audit.log({ userId: user.id, action: flagged ? 'feedback.flag' : 'feedback.unflag', entity: 'Feedback', entityId: id, data: { note } });
    return this.presentFeedback(updated);
  }

  async resolve(user: AuthUser, id: number, note?: string) {
    const f = await this.prisma.feedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Không tìm thấy đánh giá');
    assertBranchAccess(user, f.branchId);
    const updated = await this.prisma.feedback.update({
      where: { id },
      data: { status: 'RESOLVED', flagNote: note ?? f.flagNote },
      include: FEEDBACK_INCLUDE,
    });
    await this.audit.log({ userId: user.id, action: 'feedback.resolve', entity: 'Feedback', entityId: id, data: { note } });
    return this.presentFeedback(updated);
  }

  /** Ẩn đánh giá món vi phạm khỏi menu công khai */
  async setDishReviewHidden(user: AuthUser, id: number, isHidden: boolean) {
    const r = await this.prisma.dishReview.findUnique({ where: { id }, include: { session: true } });
    if (!r) throw new NotFoundException('Không tìm thấy đánh giá món');
    if (r.session) assertBranchAccess(user, r.session.branchId);
    const updated = await this.prisma.dishReview.update({ where: { id }, data: { isHidden } });
    await this.audit.log({ userId: user.id, action: 'dish_review.visibility', entity: 'DishReview', entityId: id, data: { isHidden } });
    return updated;
  }

  // =========================================================== helpers

  private async getReviewableSession(token: string) {
    const session = await this.sessions.getByToken(token, false);
    if (session.closedAt && session.closedAt < addDays(new Date(), -REVIEW_WINDOW_DAYS)) {
      throw new BadRequestException(`Đã quá ${REVIEW_WINDOW_DAYS} ngày kể từ bữa ăn, không thể đánh giá`);
    }
    return session;
  }

  /** FR-19: ẩn danh tính khách với đánh giá ẩn danh */
  private presentFeedback<T extends { isAnonymous: boolean; customer: { id: number; fullName: string; phone: string | null } | null }>(f: T) {
    return { ...f, customer: f.isAnonymous ? null : f.customer };
  }
}
