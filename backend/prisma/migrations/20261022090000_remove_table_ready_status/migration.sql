-- US-9 AC1: bàn chỉ còn 4 trạng thái Trống / Đang có khách / Đã đặt / Đang dọn dẹp.
-- Bỏ trạng thái READY ("Sẵn sàng"); bàn đang READY được chuyển về AVAILABLE để không mất dữ liệu (DoD B-07).
BEGIN;
UPDATE "DiningTable" SET "status" = 'AVAILABLE' WHERE "status" = 'READY';

-- AlterEnum
CREATE TYPE "TableStatus_new" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING');
ALTER TABLE "public"."DiningTable" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "DiningTable" ALTER COLUMN "status" TYPE "TableStatus_new" USING ("status"::text::"TableStatus_new");
ALTER TYPE "TableStatus" RENAME TO "TableStatus_old";
ALTER TYPE "TableStatus_new" RENAME TO "TableStatus";
DROP TYPE "public"."TableStatus_old";
ALTER TABLE "DiningTable" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
COMMIT;
