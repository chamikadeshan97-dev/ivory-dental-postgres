
import "dotenv/config";
import crypto from "node:crypto";

import {
  uploadClinicalFileToS3,
  getS3FileMetadata,
  getS3FileStream,
  deleteS3File,
} from "./services/s3Service.js";

// Minimal valid PNG image for testing
const pngBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
  "base64",
);

const run = async () => {
  let uploadedKey = null;

  try {
    console.log("1. Uploading temporary test image...");

    const uploaded = await uploadClinicalFileToS3({
      buffer: pngBuffer,
      fileName: `r2-test-${crypto.randomUUID()}.png`,
      mimeType: "image/png",
      patientId: "r2-connection-test",
      categoryFolder: "temporary",
    });

    uploadedKey = uploaded.key;

    console.log("Upload successful:", uploadedKey);

    console.log("2. Reading file metadata...");

    const metadata = await getS3FileMetadata(uploadedKey);

    if (
      metadata.mimeType !== "image/png" ||
      metadata.size !== pngBuffer.length
    ) {
      throw new Error("Uploaded metadata does not match");
    }

    console.log("Metadata verified.");

    console.log("3. Downloading test image...");

    const result = await getS3FileStream(uploadedKey);

    const chunks = [];

    for await (const chunk of result.stream) {
      chunks.push(Buffer.from(chunk));
    }

    const downloaded = Buffer.concat(chunks);

    if (!downloaded.equals(pngBuffer)) {
      throw new Error("Downloaded file does not match upload");
    }

    console.log("Downloaded content verified.");

    console.log("4. Deleting test image...");

    await deleteS3File(uploadedKey);
    uploadedKey = null;

    console.log("Delete request successful.");

    console.log("ALL R2 OPERATIONS PASSED!");
  } catch (error) {
    console.error("R2 operation test failed:", {
      name: error.name,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
    });

    process.exitCode = 1;
  } finally {
    if (uploadedKey) {
      try {
        await deleteS3File(uploadedKey);
        console.log("Temporary file cleanup successful.");
      } catch (cleanupError) {
        console.error(
          "Temporary file cleanup failed:",
          cleanupError.message,
        );
      }
    }
  }
};

run();
