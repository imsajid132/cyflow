-- Named data stores: group DataStoreRecord rows under a DataStore, with keys
-- unique per-store instead of globally. Existing records are backfilled into a
-- stable "Default store" so the engine's default keyspace is preserved.

-- CreateTable
CREATE TABLE "DataStore" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataStore_pkey" PRIMARY KEY ("id")
);

-- Seed the default store (stable id the engine resolves for its keyspace).
INSERT INTO "DataStore" ("id", "name", "updatedAt")
VALUES ('default_store', 'Default store', CURRENT_TIMESTAMP);

-- Add the store reference to existing records (nullable first, then backfill).
ALTER TABLE "DataStoreRecord" ADD COLUMN "storeId" TEXT;
UPDATE "DataStoreRecord" SET "storeId" = 'default_store' WHERE "storeId" IS NULL;
ALTER TABLE "DataStoreRecord" ALTER COLUMN "storeId" SET NOT NULL;

-- Replace the global unique key with a per-store unique key.
DROP INDEX IF EXISTS "DataStoreRecord_key_key";
CREATE UNIQUE INDEX "DataStoreRecord_storeId_key_key" ON "DataStoreRecord"("storeId", "key");
CREATE INDEX "DataStoreRecord_storeId_idx" ON "DataStoreRecord"("storeId");

-- AddForeignKey
ALTER TABLE "DataStoreRecord" ADD CONSTRAINT "DataStoreRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "DataStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
