import { Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { StorageService } from '../core/storage.service';
import { TableSessionsService } from '../tables/table-sessions.service';

const FILE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };
const MAX_UPLOAD = { limits: { fileSize: 5 * 1024 * 1024 } };

@ApiTags('Upload ảnh')
@Controller()
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly sessions: TableSessionsService,
  ) {}

  /** Nhân viên / khách đã đăng nhập tải ảnh (ảnh món, avatar...) */
  @ApiBearerAuth()
  @Post('uploads/images')
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  async upload(@UploadedFile() file: Express.Multer.File) {
    return { url: await this.storage.saveImage(file, 'general') };
  }

  /** FR-18: khách tại bàn tải ảnh đính kèm đánh giá */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/sessions/:token/uploads')
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  async uploadForSession(@Param('token') token: string, @UploadedFile() file: Express.Multer.File) {
    await this.sessions.getByToken(token, false);
    return { url: await this.storage.saveImage(file, 'feedback') };
  }
}
