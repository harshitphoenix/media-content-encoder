import sharp, { type OutputInfo } from 'sharp';
import { eq } from 'drizzle-orm';
import { mediaVariants, type Database } from '@mce/db';
import { IMAGE_VARIANT_SIZES, type ImageProcessJobPayload } from '@mce/shared';
import { StorageClient, variantKey } from '@mce/storage';

// ── Variant / format configuration ────────────────────────────────────────────

const VARIANT_SPECS = [
  { variantType: 'image_thumbnail' as const, maxBox: IMAGE_VARIANT_SIZES.thumbnail },
  { variantType: 'image_small' as const, maxBox: IMAGE_VARIANT_SIZES.small },
  { variantType: 'image_medium' as const, maxBox: IMAGE_VARIANT_SIZES.medium },
  { variantType: 'image_large' as const, maxBox: IMAGE_VARIANT_SIZES.large },
  { variantType: 'image_original' as const, maxBox: null }, // no resize, format-convert only
] as const;

const FORMAT_SPECS = [
  { format: 'webp' as const, mimeType: 'image/webp', quality: 80 },
  { format: 'avif' as const, mimeType: 'image/avif', quality: 65 },
  { format: 'jpeg' as const, mimeType: 'image/jpeg', quality: 85 },
] as const;

type VariantType = (typeof VARIANT_SPECS)[number]['variantType'];
type OutputFormat = (typeof FORMAT_SPECS)[number]['format'];

interface VariantRecord {
  assetId: string;
  jobId: string;
  variantType: VariantType;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBytes: number;
  storageKey: string;
}

// ── Core processing function ──────────────────────────────────────────────────

export async function processImageJob(
  job: { id: string; data: ImageProcessJobPayload },
  db: Database,
  storage: StorageClient,
): Promise<void> {
  const { assetId, storageKey: originalStorageKey, crop } = job.data;

  // 1. Download original into memory buffer
  const originalBuffer = await storage.download(storage.bucketOriginals, originalStorageKey);

  // 2. Generate every variant × format combination
  const variantRecords: VariantRecord[] = [];
  const uploadPromises: Promise<void>[] = [];

  for (const { variantType, maxBox } of VARIANT_SPECS) {
    for (const { format, mimeType, quality } of FORMAT_SPECS) {
      const { data, width, height, sizeBytes } = await renderVariant(originalBuffer, {
        maxBox,
        ...(crop !== undefined ? { crop } : {}),
        format,
        quality,
      });
      const key = variantKey({ assetId, variantType, format });

      // Upload can proceed concurrently across variants
      uploadPromises.push(
        storage.upload(storage.bucketVariants, key, data, {
          contentType: mimeType,
          cacheControl: 'public, max-age=31536000, immutable',
        }),
      );

      variantRecords.push({
        assetId,
        jobId: job.id,
        variantType,
        format,
        width,
        height,
        sizeBytes,
        storageKey: key,
      });
    }
  }

  // 3. Wait for all uploads to finish before writing DB records
  await Promise.all(uploadPromises);

  // 4. Batch-insert all variant rows
  await db.insert(mediaVariants).values(variantRecords);
}

// ── Sharp render helper ───────────────────────────────────────────────────────

async function renderVariant(
  buffer: Buffer,
  opts: {
    maxBox: number | null;
    crop?: { x: number; y: number; width: number; height: number };
    format: OutputFormat;
    quality: number;
  },
): Promise<{ data: Buffer; width: number; height: number; sizeBytes: number }> {
  const img = sharp(buffer);

  if (opts.crop) {
    img.extract({
      left: opts.crop.x,
      top: opts.crop.y,
      width: opts.crop.width,
      height: opts.crop.height,
    });
  }

  if (opts.maxBox !== null) {
    img.resize(opts.maxBox, opts.maxBox, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let output: { data: Buffer; info: OutputInfo };

  if (opts.format === 'webp') {
    output = await img.webp({ quality: opts.quality }).toBuffer({ resolveWithObject: true });
  } else if (opts.format === 'avif') {
    output = await img.avif({ quality: opts.quality }).toBuffer({ resolveWithObject: true });
  } else {
    output = await img.jpeg({ quality: opts.quality }).toBuffer({ resolveWithObject: true });
  }

  return {
    data: output.data,
    width: output.info.width,
    height: output.info.height,
    sizeBytes: output.info.size,
  };
}

// ── Cleanup: remove variants on permanent job failure ─────────────────────────

export async function deleteImageVariants(
  assetId: string,
  db: Database,
  storage: StorageClient,
): Promise<void> {
  const rows = await db
    .select({ storageKey: mediaVariants.storageKey })
    .from(mediaVariants)
    .where(eq(mediaVariants.assetId, assetId));

  const keys = rows.map(r => r.storageKey);
  if (keys.length > 0) {
    await storage.deleteMany(storage.bucketVariants, keys);
    await db.delete(mediaVariants).where(eq(mediaVariants.assetId, assetId));
  }
}
