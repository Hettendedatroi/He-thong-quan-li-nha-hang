import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { CoreModule } from './core/core.module';
import { MenuModule } from './menu/menu.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromotionsModule } from './promotions/promotions.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';
import { TablesModule } from './tables/tables.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-only-secret-change-me',
      }),
    }),
    ScheduleModule.forRoot(),
    // NFR-02: giới hạn tần suất gọi API để chống spam
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    // Hạ tầng dùng chung
    PrismaModule,
    CoreModule,
    RealtimeModule,
    NotificationsModule,

    // Nghiệp vụ
    AuthModule,
    UsersModule,
    BranchesModule,
    TablesModule,
    MenuModule,
    PromotionsModule,
    ReservationsModule,
    OrdersModule,
    ServiceRequestsModule,
    UploadsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
