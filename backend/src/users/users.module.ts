import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { AdminUsersController, AuditLogsController, RolesController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [AdminUsersController, RolesController, AuditLogsController],
  providers: [UsersService, RolesService],
  exports: [UsersService],
})
export class UsersModule {}
