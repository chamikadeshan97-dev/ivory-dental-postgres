
import "dotenv/config";

import {
  S3Client,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const required = [
  "S3_ENDPOINT",
  "S3_BUCKET_NAME",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];

const missing = required.filter(
  (name) => !process.env[name],
);

if (missing.length > 0) {
  console.error(
    "Missing environment variables:",
    missing.join(", "),
  );

  process.exit(1);
}

const client = new S3Client({
  region: process.env.S3_REGION || "auto",

  endpoint: process.env.S3_ENDPOINT,

  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY,
  },

  forcePathStyle: true,

  maxAttempts: 3,
});

const testConnection = async () => {
  try {
    console.log("Testing Cloudflare R2 connection...");

    await client.send(
      new HeadBucketCommand({
        Bucket: process.env.S3_BUCKET_NAME,
      }),
    );

    console.log("Cloudflare R2 connection successful!");
    console.log(
      "Bucket:",
      process.env.S3_BUCKET_NAME,
    );
    console.log("Bucket access verified.");
  } catch (error) {
    console.error("Cloudflare R2 connection failed.");

    console.error({
      name: error.name,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
    });

    process.exitCode = 1;
  } finally {
    client.destroy();
  }
};

testConnection();
