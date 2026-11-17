
import prisma from "../config/prisma.js";

/* ========================================================
   GENERAL HELPERS
======================================================== */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => {
  return String(value ?? "").trim();
};

const normalizeDistance = (value) => {
  const distance = Number(value);

  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }

  return distance;
};

/* ========================================================
   LOCATION ID GENERATOR
======================================================== */

const generateLocationId = (locations = []) => {
  const largestNumber = locations.reduce(
    (largest, location) => {
      const match = String(
        location?.id || "",
      ).match(/^LOC_(\d+)$/i);

      if (!match) {
        return largest;
      }

      return Math.max(largest, Number(match[1]));
    },
    0,
  );

  return `LOC_${String(largestNumber + 1).padStart(4, "0")}`;
};

/* ========================================================
   PRISMA RESPONSE MAPPER
======================================================== */

const formatLocation = (location) => {
  if (!location) return null;

  return {
    id: normalizeText(location.id),
    location: normalizeText(location.location),
    distance_km: Number(location.distanceKm) || 0,
  };
};

/* ========================================================
   DATABASE HELPERS
======================================================== */

const getAllLocationRows = async (db = prisma) => {
  return db.location.findMany();
};

const findLocationById = async (id, db = prisma) => {
  const normalizedId = normalizeText(id);

  if (!normalizedId) return null;

  return db.location.findFirst({
    where: {
      id: {
        equals: normalizedId,
        mode: "insensitive",
      },
    },
  });
};

const findDuplicateLocation = async (
  locationName,
  ignoredId = null,
  db = prisma,
) => {
  const locations = await getAllLocationRows(db);

  const normalizedName = normalizeText(
    locationName,
  ).toLowerCase();

  const normalizedIgnoredId = ignoredId
    ? normalizeText(ignoredId).toLowerCase()
    : null;

  return locations.find((item) => {
    const sameName =
      normalizeText(item.location).toLowerCase() ===
      normalizedName;

    const isIgnored =
      normalizedIgnoredId &&
      normalizeText(item.id).toLowerCase() ===
        normalizedIgnoredId;

    return sameName && !isIgnored;
  });
};

/* ========================================================
   1. GET ALL LOCATIONS
======================================================== */

export const getAllLocationsService = async () => {
  const locations = await getAllLocationRows();

  return locations
    .map(formatLocation)
    .filter(
      (location) =>
        location.id &&
        location.location,
    )
    .sort(
      (firstLocation, secondLocation) =>
        firstLocation.distance_km -
          secondLocation.distance_km ||
        firstLocation.location.localeCompare(
          secondLocation.location,
          undefined,
          {
            sensitivity: "base",
          },
        ),
    );
};

/* ========================================================
   2. GET LOCATION BY ID
======================================================== */

export const getLocationByIdService = async (id) => {
  const locationId = normalizeText(id);

  if (!locationId) {
    return null;
  }

  const location = await findLocationById(locationId);

  return location ? formatLocation(location) : null;
};

/* ========================================================
   3. CREATE LOCATION
======================================================== */

export const createLocationService = async (data = {}) => {
  const locationName = normalizeText(data.location);

  const distanceKm = normalizeDistance(
    data.distance_km,
  );

  if (!locationName) {
    throw createError(
      "Location name is required.",
      400,
    );
  }

  if (distanceKm === null) {
    throw createError(
      "Distance must be a valid number greater than or equal to 0.",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      /*
       * Prevent two concurrent requests from
       * generating the same LOC ID.
       */
      await tx.$executeRaw`
        LOCK TABLE "locations" IN EXCLUSIVE MODE
      `;

      const duplicate = await findDuplicateLocation(
        locationName,
        null,
        tx,
      );

      if (duplicate) {
        throw createError(
          "A location with this name already exists.",
          409,
        );
      }

      const existingLocations =
        await getAllLocationRows(tx);

      const newLocation = await tx.location.create({
        data: {
          id: generateLocationId(existingLocations),

          location: locationName,

          // Prisma model stores distance as String.
          distanceKm: String(distanceKm),
        },
      });

      return formatLocation(newLocation);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   4. UPDATE LOCATION
======================================================== */

export const updateLocationService = async (
  id,
  data = {},
) => {
  const locationId = normalizeText(id);

  const locationName = normalizeText(data.location);

  const distanceKm = normalizeDistance(
    data.distance_km,
  );

  if (!locationId) {
    throw createError(
      "Location ID is required.",
      400,
    );
  }

  if (!locationName) {
    throw createError(
      "Location name is required.",
      400,
    );
  }

  if (distanceKm === null) {
    throw createError(
      "Distance must be a valid number greater than or equal to 0.",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "locations" IN EXCLUSIVE MODE
      `;

      const existing = await findLocationById(
        locationId,
        tx,
      );

      if (!existing) {
        throw createError(
          "Location not found.",
          404,
        );
      }

      const duplicate = await findDuplicateLocation(
        locationName,
        existing.id,
        tx,
      );

      if (duplicate) {
        throw createError(
          "A location with this name already exists.",
          409,
        );
      }

      const updated = await tx.location.update({
        where: {
          id: existing.id,
        },
        data: {
          location: locationName,
          distanceKm: String(distanceKm),
        },
      });

      return formatLocation(updated);
    },
    {
      timeout: 15000,
    },
  );
};

/* ========================================================
   5. DELETE LOCATION
======================================================== */

export const deleteLocationService = async (id) => {
  const locationId = normalizeText(id);

  if (!locationId) {
    throw createError(
      "Location ID is required.",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "locations" IN EXCLUSIVE MODE
      `;

      const existing = await findLocationById(
        locationId,
        tx,
      );

      if (!existing) {
        throw createError(
          "Location not found.",
          404,
        );
      }

      const deleted = await tx.location.delete({
        where: {
          id: existing.id,
        },
      });

      return formatLocation(deleted);
    },
    {
      timeout: 15000,
    },
  );
};
