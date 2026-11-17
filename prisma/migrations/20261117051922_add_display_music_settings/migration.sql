-- CreateTable
CREATE TABLE "display_music" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "music_youtube_url" TEXT NOT NULL DEFAULT '',
    "music_video_id" TEXT NOT NULL DEFAULT '',
    "music_playing" BOOLEAN NOT NULL DEFAULT false,
    "music_volume" INTEGER NOT NULL DEFAULT 20,
    "video_youtube_url" TEXT NOT NULL DEFAULT '',
    "video_video_id" TEXT NOT NULL DEFAULT '',
    "video_playing" BOOLEAN NOT NULL DEFAULT false,
    "video_volume" INTEGER NOT NULL DEFAULT 50,
    "display_mode" TEXT NOT NULL DEFAULT 'queue',
    "updated_at" TEXT,

    CONSTRAINT "display_music_pkey" PRIMARY KEY ("id")
);
