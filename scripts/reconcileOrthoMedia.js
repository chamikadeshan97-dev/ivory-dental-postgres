
import "dotenv/config";

import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import prisma from "../config/prisma.js";

/* ========================================================
   CONFIGURATION
======================================================== */

const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.S3_REGION || "auto";
const ENDPOINT = process.env.S3_ENDPOINT;

const ACCESS_KEY_ID =
  process.env.S3_ACCESS_KEY_ID;

const SECRET_ACCESS_KEY =
  process.env.S3_SECRET_ACCESS_KEY;

const SAFETY_HOURS = 24;

const PREFIX = "patients/";

const MAX_REPORT_ITEMS = 100;

const normalize = (value) =>
  String(value ?? "").trim();

/* ========================================================
   R2 CLIENT
======================================================== */

if (
  !BUCKET ||
  !ENDPOINT ||
  !ACCESS_KEY_ID ||
  !SECRET_ACCESS_KEY
) {
  throw new Error(
    "Missing Cloudflare R2 configuration",
  );
}

const parsedEndpoint = new URL(ENDPOINT);

if (
  parsedEndpoint.protocol !== "https:" ||
  !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(
    parsedEndpoint.hostname,
  ) ||
  parsedEndpoint.pathname !== "/" ||
  parsedEndpoint.search ||
  parsedEndpoint.hash ||
  parsedEndpoint.username ||
  parsedEndpoint.password ||
  REGION !== "auto"
) {
  throw new Error(
    "Invalid Cloudflare R2 endpoint or region",
  );
}

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,

  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },

  forcePathStyle: true,
  maxAttempts: 3,
});

/* ========================================================
   ORTHO OBJECT FILTER
======================================================== */

const isOrthoObject = (key) => {
  const parts = normalize(key).split("/");

  return (
    parts.length === 4 &&
    parts[0] === "patients" &&
    Boolean(parts[1]) &&
    parts[2].startsWith("ortho_") &&
    Boolean(parts[3])
  );
};

/* ========================================================
   LIST R2 OBJECTS — PAGINATED
======================================================== */

const listOrthoObjects = async () => {
  const objects = [];

  let continuationToken;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        MaxKeys: 1000,

        ...(continuationToken
          ? {
              ContinuationToken:
                continuationToken,
            }
          : {}),
      }),
    );

    for (const object of response.Contents || []) {
      if (
        object.Key &&
        isOrthoObject(object.Key)
      ) {
        objects.push({
          key: object.Key,
          size: object.Size ?? 0,
          lastModified:
            object.LastModified ?? null,
        });
      }
    }

    if (
      response.IsTruncated &&
      !response.NextContinuationToken
    ) {
      throw new Error(
        "R2 listing is truncated but no continuation token was returned",
      );
    }

    continuationToken =
      response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
  } while (continuationToken);

  return objects;
};

/* ========================================================
   GET DATABASE REFERENCES
======================================================== */

const getDatabaseKeys = async () => {
  const records =
    await prisma.orthoMedia.findMany({
      where: {
        s3Key: {
          not: null,
        },
      },

      select: {
        s3Key: true,
      },
    });

  return new Set(
    records
      .map((record) => normalize(record.s3Key))
      .filter(Boolean),
  );
};

/* ========================================================
   RECONCILIATION
======================================================== */

const reconcile = async () => {
  console.log(
    "\nIVORY DENTAL — ORTHO MEDIA RECONCILIATION",
  );

  console.log("Mode: READ ONLY");
  console.log("Bucket:", BUCKET);
  console.log("Prefix:", PREFIX);
  console.log(
    "Safety window:",
    `${SAFETY_HOURS} hours`,
  );

  /*
   * Read database references before listing R2.
   *
   * New uploads can appear during the scan.
   * The safety window protects recent objects.
   */
  const databaseKeys =
    await getDatabaseKeys();

  const r2Objects =
    await listOrthoObjects();

  const cutoff =
    Date.now() -
    SAFETY_HOURS * 60 * 60 * 1000;

  const orphanCandidates = [];
  const recentUnreferenced = [];
  const referenced = [];

  for (const object of r2Objects) {
    if (databaseKeys.has(object.key)) {
      referenced.push(object);
      continue;
    }

    const modifiedAt =
      object.lastModified
        ? new Date(object.lastModified).getTime()
        : NaN;

    if (
      !Number.isFinite(modifiedAt) ||
      modifiedAt > cutoff
    ) {
      recentUnreferenced.push(object);
      continue;
    }

    orphanCandidates.push(object);
  }

  console.log("\n--- SUMMARY ---");

  console.log(
    "Ortho R2 objects:",
    r2Objects.length,
  );

  console.log(
    "Database object references:",
    databaseKeys.size,
  );

  console.log(
    "Matched R2 objects:",
    referenced.length,
  );

  console.log(
    "Recent / undated unreferenced objects:",
    recentUnreferenced.length,
  );

  console.log(
    "Potential orphan objects:",
    orphanCandidates.length,
  );

  if (orphanCandidates.length) {
    console.log(
      "\n--- POTENTIAL ORPHANS ---",
    );

    console.table(
      orphanCandidates
        .slice(0, MAX_REPORT_ITEMS)
        .map((object) => ({
          key: object.key,
          size: object.size,
          lastModified:
            object.lastModified
              ? new Date(
                  object.lastModified,
                ).toISOString()
              : "Unknown",
        })),
    );

    if (
      orphanCandidates.length >
      MAX_REPORT_ITEMS
    ) {
      console.log(
        `Showing first ${MAX_REPORT_ITEMS} of ${orphanCandidates.length} candidates`,
      );
    }
  }

  console.log(
    "\nNo objects were deleted.",
  );

  console.log(
    "Review candidates manually before taking any action.",
  );
};

/* ========================================================
   RUN
======================================================== */

try {
  await reconcile();
} catch (error) {
  console.error(
    "\nReconciliation failed:",
    error.message,
  );

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  s3.destroy();
}
