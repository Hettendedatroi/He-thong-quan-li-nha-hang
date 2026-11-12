import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomToken } from '../common/utils/codes';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Lưu file ảnh lên ổ đĩa (thư mục uploads/), phục vụ tĩnh tại /uploads/...
 * Khi deploy thật có thể thay bằng S3 / Cloudinary mà không đổi API.
 */
@Injectable()
export class StorageService {
  private readonly root = join(process.cwd(), 'uploads');

  async saveImage(file: Express.Multer.File | undefined, folder: string): Promise<string> {
    if (!file) throw new BadRequestException('Thiếu file ảnh (field "file")');
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Chỉ chấp nhận ảnh JPG, PNG, WEBP, GIF');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Ảnh tối đa 5MB');

    const safeFolder = folder.replace(/[^a-z0-9-_]/gi, '');
    const dir = join(this.root, safeFolder);
    await mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${randomToken(6)}${ext || extname(file.originalname)}`;
    await writeFile(join(dir, filename), file.buffer);
    return `/uploads/${safeFolder}/${filename}`;
  }
}
