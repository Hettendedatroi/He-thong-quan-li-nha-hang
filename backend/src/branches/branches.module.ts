import { Module } from '@nestjs/common';
import { BranchesAdminController, PublicBranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  controllers: [PublicBranchesController, BranchesAdminController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
