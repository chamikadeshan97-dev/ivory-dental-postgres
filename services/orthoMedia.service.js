
import {
  uploadMulterFileToS3,
  getS3FileStream,
  deleteS3File,
  S3_CONFIG,
} from "./s3Service.js";

import {
  getOrthoMediaFolder,
} from "../utils/patientMedia.js";

import prisma from "../config/prisma.js";

/* ========================================================
   CONFIG
======================================================== */

const MAX_FILES = 10;
const STORAGE_PROVIDER = "s3";

const ENABLE_PERMANENT_DELETE =
  process.env.ENABLE_ORTHO_MEDIA_PERMANENT_DELETE ===
  "true";

/*
 * Keep the existing advisory lock identifier.
 * All writers allocating sequential ORM IDs must
 * use this same PostgreSQL transaction lock.
 */
const MEDIA_ID_LOCK = 72819401;

/* ========================================================
   GENERAL HELPERS
======================================================== */

const normalize = (value) =>
  String(value ?? "").trim();

const normalizeLower = (value) =>
  normalize(value).toLowerCase();

const isTrue = (value) =>
  ["true", "1", "yes"].includes(
    normalizeLower(value),
  );

const isDeleted = (record) =>
  isTrue(record?.is_deleted);

const matchesId = (a, b) =>
  normalizeLower(a) === normalizeLower(b);

const nowISO = () =>
  new Date().toISOString();

const todayISO = () =>
  new Date().toISOString().slice(0, 10);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
};

/* ========================================================
   RESPONSE FORMAT — UNCHANGED
======================================================== */

const formatOrthoMedia = (record) => {
  if (!record) return null;

  return {
    ortho_media_id: record.orthoMediaId,
    ortho_case_id: record.orthoCaseId,
    patient_id: record.patientId,
    ortho_visit_id: record.orthoVisitId ?? "",

    media_date: record.mediaDate ?? "",
    media_type: record.mediaType ?? "",
    category: record.category ?? "",
    stage: record.stage ?? "",
    description: record.description ?? "",

    drive_file_id: record.driveFileId ?? "",
    drive_folder_id: record.driveFolderId ?? "",

    file_name: record.fileName ?? "",
    mime_type: record.mimeType ?? "",
    file_size: record.fileSize ?? "",

    uploaded_by: record.uploadedBy ?? "",
    uploaded_at: record.uploadedAt ?? "",

    is_deleted: record.isDeleted ?? "FALSE",

    storage_provider:
      record.storageProvider ?? "",

    s3_bucket: record.s3Bucket ?? "",
    s3_key: record.s3Key ?? "",

    deleted_at: record.deletedAt ?? "",
  };
};

/* ========================================================
   STORAGE VALIDATION
======================================================== */

const ensureS3Media = (media) => {
  if (!media) {
    throw createError(
      "Ortho media not found",
      404,
    );
  }

  if (
    normalizeLower(media.storage_provider) !==
      STORAGE_PROVIDER ||
    !normalize(media.s3_key)
  ) {
    throw createError(
      "This media record does not have a valid S3 object",
      409,
    );
  }

  if (
    normalize(media.s3_bucket) &&
    normalize(media.s3_bucket) !== S3_CONFIG.bucket
  ) {
    throw createError(
      "Media belongs to a different S3 bucket",
      409,
    );
  }

  return normalize(media.s3_key);
};

/* ========================================================
   SAFE SEQUENTIAL MEDIA ID GENERATION
======================================================== */

const getMaximumMediaNumber = (records = []) => {
  let maximum = 0;

  for (const record of records) {
    const id = normalize(record.orthoMediaId);

    const match = id.match(/^ORM_(\d+)$/i);

    if (!match) continue;

    const number = Number(match[1]);

    if (
      Number.isSafeInteger(number) &&
      number > maximum
    ) {
      maximum = number;
    }
  }

  return maximum;
};

const formatMediaId = (number) => {
  if (
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw createError(
      "Invalid media ID sequence",
      500,
    );
  }

  return `ORM_${String(number).padStart(6, "0")}`;
};

/* ========================================================
   FILE NAME HELPERS
======================================================== */

const sanitizeFileName = (value) =>
  normalize(value)
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 170);

const getFileExtension = (fileName) => {
  const match = normalize(fileName).match(
    /(\.[^./\\]+)$/,
  );

  return match
    ? match[1].toLowerCase()
    : "";
};

/*
 * R2 filenames do not require a sequential ORM ID.
 * The S3-compatible storage service generates a UUID
 * object key independently.
 */
const buildOrthoFileName = ({
  patientId,
  caseId,
  visitId,
  mediaType,
  category,
  stage,
  originalName,
}) => {
  const extension =
    getFileExtension(originalName);

  const date = todayISO().replaceAll("-", "");

  const parts = [
    patientId,
    caseId,
    visitId || null,
    date,
    mediaType,
    category,
    stage,
  ].filter(Boolean);

  const baseName =
    sanitizeFileName(parts.join("_")) ||
    "ortho_media";

  return `${baseName.slice(0, 150)}${extension}`;
};

/* ========================================================
   DATABASE HELPERS
======================================================== */

const findMediaById = async (
  mediaId,
  db = prisma,
) => {
  if (!normalize(mediaId)) {
    return null;
  }

  return db.orthoMedia.findFirst({
    where: {
      orthoMediaId: {
        equals: normalize(mediaId),
        mode: "insensitive",
      },
    },
  });
};

const findOrthoCase = async (
  caseId,
  db = prisma,
) => {
  if (!normalize(caseId)) {
    return null;
  }

  return db.orthoCase.findFirst({
    where: {
      orthoCaseId: {
        equals: normalize(caseId),
        mode: "insensitive",
      },
    },
  });
};

/* ========================================================
   UPLOAD RECOVERY HELPERS
======================================================== */

/*
 * Never delete an uploaded object unless we can
 * verify that PostgreSQL has no reference to it.
 *
 * This protects against uncertain transaction
 * commit outcomes.
 */
const reconcileFailedUpload = async (
  uploadedKeys,
) => {
  if (!uploadedKeys.length) {
    return;
  }

  let referencedKeys;

  try {
    const records =
      await prisma.orthoMedia.findMany({
        where: {
          s3Key: {
            in: uploadedKeys,
          },
        },
        select: {
          s3Key: true,
        },
      });

    referencedKeys = new Set(
      records
        .map((record) => normalize(record.s3Key))
        .filter(Boolean),
    );
  } catch (error) {
    console.error(
      "Unable to verify failed upload against database. " +
      "Preserving R2 objects for reconciliation.",
      {
        keys: uploadedKeys,
        error: error.message,
      },
    );

    return;
  }

  for (const key of uploadedKeys) {
    if (referencedKeys.has(key)) {
      console.warn(
        "Preserving R2 object referenced by database:",
        key,
      );

      continue;
    }

    try {
      await deleteS3File(key);

      console.info(
        "Cleaned unreferenced R2 upload:",
        key,
      );
    } catch (error) {
      console.error(
        "R2 upload cleanup failed. " +
        "Manual reconciliation required.",
        {
          key,
          error: error.message,
        },
      );
    }
  }
};

/* ========================================================
   1. GET ALL RECORDS
======================================================== */

export const getAllOrthoMediaRecords =
  async ({ forceRefresh = false } = {}) => {
    void forceRefresh;

    const records =
      await prisma.orthoMedia.findMany();

    return records.map(formatOrthoMedia);
  };

/* ========================================================
   2. GET ACTIVE RECORDS
======================================================== */

export const getActiveOrthoMediaRecords =
  async () => {
    const records =
      await prisma.orthoMedia.findMany({
        where: {
          OR: [
            { isDeleted: null },
            { isDeleted: "" },
            { isDeleted: "FALSE" },
            { isDeleted: "false" },
            { isDeleted: "0" },
          ],
        },
      });

    return records
      .map(formatOrthoMedia)
      .filter((record) => !isDeleted(record));
  };

/* ========================================================
   3. GET MEDIA BY ID
======================================================== */

export const getOrthoMediaByIdService =
  async (mediaId) => {
    const record =
      await findMediaById(mediaId);

    return formatOrthoMedia(record);
  };

/* ========================================================
   4. GET ACTIVE MEDIA BY ID
======================================================== */

export const getOrthoMediaById =
  async (mediaId) => {
    const media =
      await getOrthoMediaByIdService(mediaId);

    if (!media || isDeleted(media)) {
      return null;
    }

    return media;
  };

/* ========================================================
   5. GET MEDIA BY CASE
======================================================== */

export const getOrthoMediaByCaseService =
  async (caseId, filters = {}) => {
    if (!normalize(caseId)) {
      return [];
    }

    const records =
      await prisma.orthoMedia.findMany({
        where: {
          orthoCaseId: {
            equals: normalize(caseId),
            mode: "insensitive",
          },

          ...(normalize(filters.media_type)
            ? {
                mediaType: {
                  equals: normalize(filters.media_type),
                  mode: "insensitive",
                },
              }
            : {}),

          ...(normalize(filters.stage)
            ? {
                stage: {
                  equals: normalize(filters.stage),
                  mode: "insensitive",
                },
              }
            : {}),

          ...(normalize(filters.visit_id)
            ? {
                orthoVisitId: {
                  equals: normalize(filters.visit_id),
                  mode: "insensitive",
                },
              }
            : {}),
        },
      });

    return records
      .map(formatOrthoMedia)
      .filter((record) => !isDeleted(record))
      .sort(
        (a, b) =>
          (Date.parse(b.uploaded_at) || 0) -
          (Date.parse(a.uploaded_at) || 0),
      );
  };

/* ========================================================
   6. GET MEDIA BY PATIENT
======================================================== */

export const getOrthoMediaByPatientIdService =
  async (patientId) => {
    if (!normalize(patientId)) {
      return [];
    }

    const records =
      await prisma.orthoMedia.findMany({
        where: {
          patientId: {
            equals: normalize(patientId),
            mode: "insensitive",
          },
        },
      });

    return records
      .map(formatOrthoMedia)
      .filter((record) => !isDeleted(record))
      .sort(
        (a, b) =>
          (Date.parse(b.uploaded_at) || 0) -
          (Date.parse(a.uploaded_at) || 0),
      );
  };

/* ========================================================
   7. GET MEDIA BY VISIT
======================================================== */

export const getOrthoMediaByVisitService =
  async (visitId) => {
    if (!normalize(visitId)) {
      return [];
    }

    const records =
      await prisma.orthoMedia.findMany({
        where: {
          orthoVisitId: {
            equals: normalize(visitId),
            mode: "insensitive",
          },
        },
      });

    return records
      .map(formatOrthoMedia)
      .filter((record) => !isDeleted(record));
  };

/* ========================================================
   8. CREATE / UPLOAD ORTHO MEDIA
======================================================== */

export const createOrthoMediaService =
  async ({
    files,
    caseId,
    visitId = "",
    mediaDate = "",
    mediaType,
    category = "",
    stage = "",
    description = "",
    uploadedBy = "",
  }) => {
    /* ----------------------------------------------------
       VALIDATION
    ---------------------------------------------------- */

    if (
      !Array.isArray(files) ||
      files.length === 0
    ) {
      throw createError(
        "At least one file is required",
      );
    }

    if (files.length > MAX_FILES) {
      throw createError(
        "Maximum 10 files are allowed",
      );
    }

    if (!normalize(caseId)) {
      throw createError(
        "Ortho case ID is required",
      );
    }

    if (!normalize(mediaType)) {
      throw createError(
        "Media type is required",
      );
    }

    for (const file of files) {
      if (
        !file ||
        !Buffer.isBuffer(file.buffer) ||
        file.buffer.length === 0
      ) {
        throw createError(
          "Invalid file buffer. Multer must use memoryStorage().",
        );
      }

      if (
        file.buffer.length >
        S3_CONFIG.maxFileSize
      ) {
        throw createError(
          "File exceeds the 10 MB limit",
        );
      }
    }

    /* ----------------------------------------------------
       FIND CASE
    ---------------------------------------------------- */

    const orthoCase =
      await findOrthoCase(caseId);

    if (!orthoCase) {
      throw createError(
        "Ortho case not found",
        404,
      );
    }

    const patientId =
      normalize(orthoCase.patientId);

    if (!patientId) {
      throw createError(
        "Patient ID is missing from Ortho case",
      );
    }

    /* ----------------------------------------------------
       VALIDATE VISIT
    ---------------------------------------------------- */

    let resolvedVisitId = "";

    if (normalize(visitId)) {
      const visit =
        await prisma.orthoVisit.findFirst({
          where: {
            orthoVisitId: {
              equals: normalize(visitId),
              mode: "insensitive",
            },
          },
        });

      if (
        !visit ||
        !matchesId(
          visit.orthoCaseId,
          orthoCase.orthoCaseId,
        )
      ) {
        throw createError(
          "Ortho visit does not belong to this case",
          400,
        );
      }

      resolvedVisitId = visit.orthoVisitId;
    }

    /* ----------------------------------------------------
       PHASE 1 — UPLOAD TO R2
       NO DATABASE TRANSACTION
    ---------------------------------------------------- */

    const uploadedFiles = [];
    const uploadedKeys = [];

    try {
      const categoryFolder =
        getOrthoMediaFolder(mediaType);

      for (const file of files) {
        const fileName =
          buildOrthoFileName({
            patientId,
            caseId: orthoCase.orthoCaseId,
            visitId: resolvedVisitId,
            mediaType,
            category,
            stage,
            originalName: file.originalname,
          });

        const uploaded =
          await uploadMulterFileToS3({
            file,
            fileName,
            patientId,
            categoryFolder:
              `ortho_${categoryFolder || "general"}`,
          });

        uploadedFiles.push(uploaded);
        uploadedKeys.push(uploaded.key);
      }

      /* ------------------------------------------------
         PHASE 2 — SHORT DATABASE TRANSACTION
      ------------------------------------------------ */

      const newRecords =
        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(
                ${MEDIA_ID_LOCK}
              )
            `;

            const existing =
              await tx.orthoMedia.findMany({
                select: {
                  orthoMediaId: true,
                },
              });

            const maximum =
              getMaximumMediaNumber(existing);

            const createdRecords = [];

            for (
              let index = 0;
              index < uploadedFiles.length;
              index++
            ) {
              const uploaded =
                uploadedFiles[index];

              const mediaId =
                formatMediaId(
                  maximum + index + 1,
                );

              const created =
                await tx.orthoMedia.create({
                  data: {
                    orthoMediaId: mediaId,

                    orthoCaseId:
                      orthoCase.orthoCaseId,

                    patientId,

                    orthoVisitId:
                      resolvedVisitId,

                    mediaDate:
                      normalize(mediaDate) ||
                      todayISO(),

                    mediaType:
                      normalize(mediaType),

                    category:
                      normalize(category),

                    stage:
                      normalize(stage),

                    description:
                      normalize(description),

                    driveFileId: "",
                    driveFolderId: "",

                    fileName:
                      normalize(uploaded.name),

                    mimeType:
                      normalize(uploaded.mimeType),

                    fileSize:
                      normalize(uploaded.size),

                    uploadedBy:
                      normalize(uploadedBy),

                    uploadedAt:
                      nowISO(),

                    isDeleted: "FALSE",

                    storageProvider:
                      STORAGE_PROVIDER,

                    s3Bucket:
                      normalize(uploaded.bucket),

                    s3Key:
                      normalize(uploaded.key),

                    deletedAt: "",
                  },
                });

              createdRecords.push(
                formatOrthoMedia(created),
              );
            }

            return createdRecords;
          },
          {
            maxWait: 10000,
            timeout: 15000,
          },
        );

      return newRecords;
    } catch (error) {
      /*
       * Uploads and database transactions are
       * separate operations.
       *
       * Verify database references before
       * attempting cleanup.
       */
      await reconcileFailedUpload(
        uploadedKeys,
      );

      throw error;
    }
  };

/* ========================================================
   9. GET FILE STREAM
======================================================== */

export const getOrthoMediaFileStream =
  async (mediaId) => {
    const media =
      await getOrthoMediaById(mediaId);

    if (!media) {
      return null;
    }

    const key = ensureS3Media(media);

    const result =
      await getS3FileStream(key);

    return {
      media,

      metadata: {
        ...result.metadata,

        name:
          media.file_name ||
          result.metadata.name,
      },

      stream: result.stream,
    };
  };

/* ========================================================
   10. SOFT DELETE
======================================================== */

export const deleteOrthoMediaService =
  async (mediaId) => {
    const existing =
      await findMediaById(mediaId);

    if (!existing) {
      return null;
    }

    if (
      isDeleted(formatOrthoMedia(existing))
    ) {
      return formatOrthoMedia(existing);
    }

    const updated =
      await prisma.orthoMedia.update({
        where: {
          orthoMediaId:
            existing.orthoMediaId,
        },

        data: {
          isDeleted: "TRUE",
          deletedAt: nowISO(),
        },
      });

    return formatOrthoMedia(updated);
  };

/* ========================================================
   11. PERMANENT DELETE
======================================================== */

export const permanentlyDeleteOrthoMediaService =
  async (mediaId) => {
    if (!ENABLE_PERMANENT_DELETE) {
      throw createError(
        "Permanent Ortho media deletion is disabled",
        403,
      );
    }

    const existing =
      await findMediaById(mediaId);

    if (!existing) {
      return null;
    }

    const media =
      formatOrthoMedia(existing);

    const key = ensureS3Media(media);

    /*
     * Preserve the existing permanent-deletion
     * behavior and response.
     *
     * R2 deletion occurs outside transactions.
     */
    await prisma.orthoMedia.update({
      where: {
        orthoMediaId:
          existing.orthoMediaId,
      },

      data: {
        isDeleted: "TRUE",
        deletedAt:
          existing.deletedAt ||
          nowISO(),
      },
    });

    await deleteS3File(key);

    await prisma.orthoMedia.delete({
      where: {
        orthoMediaId:
          existing.orthoMediaId,
      },
    });

    return media;
  };

/* ========================================================
   12. DELETE ALL MEDIA BY CASE
======================================================== */

export const deleteAllOrthoMediaByCaseService =
  async (caseId) => {
    if (!normalize(caseId)) {
      throw createError(
        "Ortho case ID is required",
      );
    }

    if (!ENABLE_PERMANENT_DELETE) {
      throw createError(
        "Permanent Ortho media deletion is disabled",
        403,
      );
    }

    const records =
      await prisma.orthoMedia.findMany({
        where: {
          orthoCaseId: {
            equals: normalize(caseId),
            mode: "insensitive",
          },
        },
      });

    const deletedMediaIds = [];

    for (const record of records) {
      try {
        const deleted =
          await permanentlyDeleteOrthoMediaService(
            record.orthoMediaId,
          );

        if (deleted) {
          deletedMediaIds.push(
            record.orthoMediaId,
          );
        }
      } catch (error) {
        console.error(
          "Failed to delete Ortho media:",
          {
            caseId,
            mediaId:
              record.orthoMediaId,
            error: error.message,
          },
        );

        error.status =
          error.status || 500;

        error.deleted_media_ids =
          deletedMediaIds;

        throw error;
      }
    }

    return {
      case_id: caseId,

      deleted_count:
        deletedMediaIds.length,

      deleted_media_ids:
        deletedMediaIds,
    };
  };
