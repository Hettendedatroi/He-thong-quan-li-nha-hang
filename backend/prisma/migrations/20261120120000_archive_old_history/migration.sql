ALTER TABLE "Reservation" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Reservation_archivedAt_startAt_idx" ON "Reservation"("archivedAt", "startAt");
CREATE INDEX "Order_archivedAt_createdAt_idx" ON "Order"("archivedAt", "createdAt");
CREATE INDEX "User_archivedAt_createdAt_idx" ON "User"("archivedAt", "createdAt");
