CREATE TYPE "public"."asset_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'queued', 'processing', 'completed', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('image_process', 'video_transcode', 'thumbnail_generate', 'manifest_generate', 'audio_extract');--> statement-breakpoint
CREATE TYPE "public"."manifest_type" AS ENUM('hls', 'dash');--> statement-breakpoint
CREATE TYPE "public"."output_format" AS ENUM('webp', 'avif', 'jpeg', 'mp4', 'webm', 'mp3', 'aac');--> statement-breakpoint
CREATE TYPE "public"."thumbnail_type" AS ENUM('cover', 'preview', 'timeline');--> statement-breakpoint
CREATE TYPE "public"."variant_type" AS ENUM('image_thumbnail', 'image_small', 'image_medium', 'image_large', 'image_original', 'video_240p', 'video_360p', 'video_480p', 'video_720p', 'video_1080p', 'audio_normalized');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"format" varchar(64) NOT NULL,
	"color_space" varchar(64),
	"has_alpha" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_metadata_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"mime_type" varchar(100) NOT NULL,
	"original_filename" varchar(512) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"variant_type" "variant_type" NOT NULL,
	"format" "output_format" NOT NULL,
	"width" integer,
	"height" integer,
	"bitrate_bps" bigint,
	"size_bytes" bigint NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"cdn_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"job_type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"error_stack" text,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "streaming_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"manifest_type" "manifest_type" NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"cdn_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thumbnail_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"thumbnail_type" "thumbnail_type" NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"cdn_url" varchar(2048),
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"timestamp_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(256) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_seconds" real NOT NULL,
	"codec" varchar(64) NOT NULL,
	"fps" real NOT NULL,
	"bitrate_bps" bigint NOT NULL,
	"audio_codec" varchar(64),
	"audio_channels" integer,
	"audio_sample_rate_hz" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_metadata_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_metadata" ADD CONSTRAINT "image_metadata_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_job_id_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "streaming_manifests" ADD CONSTRAINT "streaming_manifests_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thumbnail_entries" ADD CONSTRAINT "thumbnail_entries_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_metadata" ADD CONSTRAINT "video_metadata_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_assets_owner_id" ON "media_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_assets_status" ON "media_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_assets_created_at" ON "media_assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_variants_asset_id" ON "media_variants" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_variants_asset_type_format" ON "media_variants" USING btree ("asset_id","variant_type","format");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_processing_jobs_asset_id" ON "processing_jobs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_processing_jobs_status" ON "processing_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_processing_jobs_type_status" ON "processing_jobs" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_streaming_manifests_asset_type" ON "streaming_manifests" USING btree ("asset_id","manifest_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thumbnail_entries_asset_type" ON "thumbnail_entries" USING btree ("asset_id","thumbnail_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" USING btree ("email");