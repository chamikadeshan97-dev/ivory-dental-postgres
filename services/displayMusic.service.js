
import prisma from "../config/prisma.js";
import appError from "../utils/appError.js";

/* =========================================================
   CONFIG
========================================================= */

const RECORD_ID = "main";

const DEFAULT_MUSIC_VOLUME = 20;
const DEFAULT_VIDEO_VOLUME = 50;
const DEFAULT_DISPLAY_MODE = "queue";

const ALLOWED_DISPLAY_MODES = ["queue", "video"];

/* =========================================================
   HELPERS
========================================================= */

const normalizeText = (value) =>
  String(value ?? "").trim();

const normalizeBoolean = (value) => {
  if (value === true || value === 1) return true;

  return ["true", "1", "yes"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
};

const normalizeVolume = (value, fallback = 20) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(
    100,
    Math.max(0, Math.round(parsed)),
  );
};

const nowIso = () => new Date().toISOString();

/* =========================================================
   YOUTUBE VIDEO ID
========================================================= */

const extractYouTubeVideoId = (url) => {
  const normalizedUrl = normalizeText(url);

  if (!normalizedUrl) return "";

  try {
    const parsedUrl = new URL(normalizedUrl);

    const hostname = parsedUrl.hostname
      .replace(/^www\./, "")
      .toLowerCase();

    if (hostname === "youtu.be") {
      return normalizeText(
        parsedUrl.pathname.split("/").filter(Boolean)[0],
      );
    }

    const isYouTubeHost =
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com");

    if (!isYouTubeHost) return "";

    const queryVideoId = parsedUrl.searchParams.get("v");

    if (queryVideoId) {
      return normalizeText(queryVideoId);
    }

    const parts = parsedUrl.pathname
      .split("/")
      .filter(Boolean);

    for (const type of ["embed", "shorts", "live"]) {
      const index = parts.indexOf(type);

      if (index !== -1 && parts[index + 1]) {
        return normalizeText(parts[index + 1]);
      }
    }

    return "";
  } catch {
    return "";
  }
};

/* =========================================================
   DEFAULT RECORD
========================================================= */

const createDefaultRecord = () => ({
  music_youtube_url: "",
  music_video_id: "",
  music_playing: false,
  music_volume: DEFAULT_MUSIC_VOLUME,

  video_youtube_url: "",
  video_video_id: "",
  video_playing: false,
  video_volume: DEFAULT_VIDEO_VOLUME,

  display_mode: DEFAULT_DISPLAY_MODE,
  updated_at: null,
});

/* =========================================================
   PRISMA RESPONSE MAPPER
========================================================= */

const normalizeRecord = (record) => {
  if (!record) return createDefaultRecord();

  const musicUrl = normalizeText(record.musicYoutubeUrl);
  const videoUrl = normalizeText(record.videoYoutubeUrl);

  const rawMode = normalizeText(
    record.displayMode,
  ).toLowerCase();

  return {
    music_youtube_url: musicUrl,

    music_video_id:
      extractYouTubeVideoId(musicUrl) ||
      normalizeText(record.musicVideoId),

    music_playing: normalizeBoolean(record.musicPlaying),

    music_volume: normalizeVolume(
      record.musicVolume,
      DEFAULT_MUSIC_VOLUME,
    ),

    video_youtube_url: videoUrl,

    video_video_id:
      extractYouTubeVideoId(videoUrl) ||
      normalizeText(record.videoVideoId),

    video_playing: normalizeBoolean(record.videoPlaying),

    video_volume: normalizeVolume(
      record.videoVolume,
      DEFAULT_VIDEO_VOLUME,
    ),

    display_mode: ALLOWED_DISPLAY_MODES.includes(rawMode)
      ? rawMode
      : DEFAULT_DISPLAY_MODE,

    updated_at: normalizeText(record.updatedAt) || null,
  };
};

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function getSettingsRecord() {
  const record = await prisma.displayMusic.findUnique({
    where: { id: RECORD_ID },
  });

  return normalizeRecord(record);
}

/*
 * Apply only the fields being changed.
 *
 * This avoids the old read-modify-write behavior
 * that could overwrite unrelated settings.
 */
async function updateSettings(patch) {
  const timestamp = nowIso();

  const saved = await prisma.displayMusic.upsert({
    where: {
      id: RECORD_ID,
    },

    create: {
      id: RECORD_ID,
      ...patch,
      updatedAt: timestamp,
    },

    update: {
      ...patch,
      updatedAt: timestamp,
    },
  });

  return normalizeRecord(saved);
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */

const musicResponse = (record) => ({
  youtube_url: record.music_youtube_url,
  video_id: record.music_video_id,
  playing: record.music_playing,
  volume: record.music_volume,
  updated_at: record.updated_at,
});

const videoResponse = (record) => ({
  youtube_url: record.video_youtube_url,
  video_id: record.video_video_id,
  playing: record.video_playing,
  volume: record.video_volume,
  updated_at: record.updated_at,
});

/* =========================================================
   1. GET DISPLAY MUSIC
========================================================= */

export async function getDisplayMusic() {
  return musicResponse(await getSettingsRecord());
}

/* =========================================================
   2. UPDATE DISPLAY MUSIC
========================================================= */

export async function updateDisplayMusic({
  youtube_url,
  playing = true,
  volume = DEFAULT_MUSIC_VOLUME,
} = {}) {
  const normalizedUrl = normalizeText(youtube_url);

  if (!normalizedUrl) {
    throw appError("YouTube URL is required.", 400);
  }

  const videoId = extractYouTubeVideoId(normalizedUrl);

  if (!videoId) {
    throw appError("Invalid YouTube URL.", 400);
  }

  const saved = await updateSettings({
    musicYoutubeUrl: normalizedUrl,
    musicVideoId: videoId,
    musicPlaying: normalizeBoolean(playing),
    musicVolume: normalizeVolume(
      volume,
      DEFAULT_MUSIC_VOLUME,
    ),
  });

  return musicResponse(saved);
}

/* =========================================================
   3. UPDATE MUSIC PLAYING STATE
========================================================= */

export async function updatePlayingState(playing) {
  const saved = await updateSettings({
    musicPlaying: normalizeBoolean(playing),
  });

  return musicResponse(saved);
}

/* =========================================================
   4. UPDATE MUSIC VOLUME
========================================================= */

export async function updateVolume(volume) {
  const parsedVolume = Number(volume);

  if (!Number.isFinite(parsedVolume)) {
    throw appError("Volume must be a valid number.", 400);
  }

  if (parsedVolume < 0 || parsedVolume > 100) {
    throw appError("Volume must be between 0 and 100.", 400);
  }

  const saved = await updateSettings({
    musicVolume: normalizeVolume(
      parsedVolume,
      DEFAULT_MUSIC_VOLUME,
    ),
  });

  return musicResponse(saved);
}

/* =========================================================
   5. GET DISPLAY VIDEO
========================================================= */

export async function getDisplayVideo() {
  return videoResponse(await getSettingsRecord());
}

/* =========================================================
   6. UPDATE DISPLAY VIDEO
========================================================= */

export async function updateDisplayVideo({
  youtube_url,
  playing = true,
  volume = DEFAULT_VIDEO_VOLUME,
} = {}) {
  const normalizedUrl = normalizeText(youtube_url);

  if (!normalizedUrl) {
    throw appError(
      "Video YouTube URL is required.",
      400,
    );
  }

  const videoId = extractYouTubeVideoId(normalizedUrl);

  if (!videoId) {
    throw appError("Invalid YouTube URL.", 400);
  }

  const saved = await updateSettings({
    videoYoutubeUrl: normalizedUrl,
    videoVideoId: videoId,
    videoPlaying: normalizeBoolean(playing),
    videoVolume: normalizeVolume(
      volume,
      DEFAULT_VIDEO_VOLUME,
    ),
  });

  return videoResponse(saved);
}

/* =========================================================
   7. UPDATE VIDEO PLAYING STATE
========================================================= */

export async function updateVideoPlayingState(playing) {
  const shouldPlay = normalizeBoolean(playing);

  /*
   * Atomic conditional update prevents a video
   * from being started after it was removed.
   */
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(918273645)
    `;

    const current = await tx.displayMusic.findUnique({
      where: { id: RECORD_ID },
    });

    const record = normalizeRecord(current);

    if (shouldPlay && !record.video_video_id) {
      throw appError(
        "No display video is configured.",
        400,
      );
    }

    const saved = await tx.displayMusic.upsert({
      where: { id: RECORD_ID },

      create: {
        id: RECORD_ID,
        videoPlaying: shouldPlay,
        updatedAt: nowIso(),
      },

      update: {
        videoPlaying: shouldPlay,
        updatedAt: nowIso(),
      },
    });

    return videoResponse(normalizeRecord(saved));
  });
}

/* =========================================================
   8. UPDATE VIDEO VOLUME
========================================================= */

export async function updateVideoVolume(volume) {
  const parsedVolume = Number(volume);

  if (!Number.isFinite(parsedVolume)) {
    throw appError("Volume must be a valid number.", 400);
  }

  if (parsedVolume < 0 || parsedVolume > 100) {
    throw appError("Volume must be between 0 and 100.", 400);
  }

  const saved = await updateSettings({
    videoVolume: normalizeVolume(
      parsedVolume,
      DEFAULT_VIDEO_VOLUME,
    ),
  });

  return videoResponse(saved);
}

/* =========================================================
   9. REMOVE DISPLAY VIDEO
========================================================= */

export async function removeDisplayVideo() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(918273645)
    `;

    const saved = await tx.displayMusic.upsert({
      where: { id: RECORD_ID },

      create: {
        id: RECORD_ID,
        videoYoutubeUrl: "",
        videoVideoId: "",
        videoPlaying: false,
        displayMode: "queue",
        updatedAt: nowIso(),
      },

      update: {
        videoYoutubeUrl: "",
        videoVideoId: "",
        videoPlaying: false,
        displayMode: "queue",
        updatedAt: nowIso(),
      },
    });

    const record = normalizeRecord(saved);

    return {
      ...videoResponse(record),
      display_mode: record.display_mode,
    };
  });
}

/* =========================================================
   10. GET DISPLAY MODE
========================================================= */

export async function getDisplayMode() {
  const record = await getSettingsRecord();

  return {
    mode: record.display_mode,
    video_playing: record.video_playing,
    updated_at: record.updated_at,
  };
}

/* =========================================================
   11. UPDATE DISPLAY MODE
========================================================= */

export async function updateDisplayMode(mode) {
  const normalizedMode = normalizeText(mode).toLowerCase();

  if (!ALLOWED_DISPLAY_MODES.includes(normalizedMode)) {
    throw appError(
      "Display mode must be queue or video.",
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(918273645)
    `;

    const current = await tx.displayMusic.findUnique({
      where: { id: RECORD_ID },
    });

    const record = normalizeRecord(current);

    if (
      normalizedMode === "video" &&
      !record.video_video_id
    ) {
      throw appError(
        "No display video is configured.",
        400,
      );
    }

    const patch = {
      displayMode: normalizedMode,
      updatedAt: nowIso(),
    };

    if (normalizedMode === "queue") {
      patch.videoPlaying = false;
    }

    const saved = await tx.displayMusic.upsert({
      where: { id: RECORD_ID },
      create: {
        id: RECORD_ID,
        ...patch,
      },
      update: patch,
    });

    const updated = normalizeRecord(saved);

    return {
      mode: updated.display_mode,

      video: {
        youtube_url: updated.video_youtube_url,
        video_id: updated.video_video_id,
        playing: updated.video_playing,
        volume: updated.video_volume,
      },

      updated_at: updated.updated_at,
    };
  });
}

/* =========================================================
   12. RESET DISPLAY MUSIC
========================================================= */

export async function resetDisplayMusic() {
  const saved = await updateSettings({
    musicYoutubeUrl: "",
    musicVideoId: "",
    musicPlaying: false,
  });

  return musicResponse(saved);
}
