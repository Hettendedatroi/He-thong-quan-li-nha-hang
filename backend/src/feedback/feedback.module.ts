import { Module } from '@nestjs/common';
import { TablesModule } from '../tables/tables.module';
import { FeedbackController, PublicFeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [TablesModule],
  controllers: [PublicFeedbackController, FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
