
import bcrypt from "bcryptjs";
import crypto from "crypto";

import prisma from "../config/prisma.js";

import { generateToken } from "../utils/token.js";

/* ========================================================
   CONFIGURATION
======================================================== */

const ALLOWED_ROLES = [
  "Admin",
  "Dentist",
  "Cashier",
  "Receptionist",
];

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

/* ========================================================
   GENERAL HELPERS
======================================================== */

const createError = (
  message,
  statusCode = 400,
) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) =>
  String(value ?? "").trim().toLowerCase();

const normalizeEmail = (value) =>
  String(value ?? "").trim().toLowerCase();

const normalizeUsername = (value) =>
  String(value ?? "").trim().toLowerCase();

const getNow = () => new Date().toISOString();

const generateUserId = () =>
  `USR_${crypto.randomBytes(8).toString("hex")}`;

const isBcryptHash = (value) =>
  BCRYPT_PATTERN.test(String(value ?? ""));

/* ========================================================
   USER RESPONSE MAPPER
======================================================== */

const sanitizeUser = (user) => {
  if (!user) return null;

  return {
    id: user.id,

    name: user.name ?? "",
    email: user.email ?? "",
    username: user.username ?? "",
    phone: user.phone ?? "",

    role: user.role ?? "",
    status: user.status ?? "",

    queue_manager: user.queueManager ?? "",
    appointment_history:
      user.appointmentHistory ?? "",
    doctor_treatment:
      user.doctorTreatment ?? "",
    payment_history:
      user.paymentHistory ?? "",
    common_treatments:
      user.commonTreatments ?? "",
    drugs: user.drugs ?? "",
    locations: user.locations ?? "",

    created_at: user.createdAt ?? "",
    updated_at: user.updatedAt ?? "",
  };
};

/* ========================================================
   USER LOOKUP HELPERS
======================================================== */

const findUserByUsername = async (username) => {
  const normalizedUsername =
    normalizeUsername(username);

  if (!normalizedUsername) return null;

  return prisma.user.findFirst({
    where: {
      username: {
        equals: normalizedUsername,
        mode: "insensitive",
      },
    },
  });
};

const findUserById = async (userId) => {
  const normalizedId = String(
    userId ?? "",
  ).trim();

  if (!normalizedId) return null;

  return prisma.user.findUnique({
    where: {
      id: normalizedId,
    },
  });
};

/* ========================================================
   USER STATUS VALIDATION
======================================================== */

const validateUserStatus = (user) => {
  const status = normalizeText(user?.status);

  if (status !== "active") {
    throw createError(
      "Your account is inactive. Please contact the administrator.",
      403,
    );
  }
};

/* ========================================================
   PASSWORD HASH HELPER
======================================================== */

export const hashPassword = async (password) => {
  const passwordValue = String(password ?? "");

  if (passwordValue.length < 6) {
    throw createError(
      "Password must contain at least 6 characters.",
      400,
    );
  }

  return bcrypt.hash(passwordValue, 12);
};

/* ========================================================
   LOGIN
======================================================== */

export const loginUser = async ({
  username,
  password,
}) => {
  const normalizedUsername =
    normalizeUsername(username);

  if (!normalizedUsername || !password) {
    throw createError(
      "Username and password are required.",
      400,
    );
  }

  const user = await findUserByUsername(
    normalizedUsername,
  );

  if (!user) {
    throw createError(
      "Invalid username or password.",
      401,
    );
  }

  /*
   * Support existing bcrypt hashes in either
   * passwordHash or legacy password.
   *
   * Never authenticate against plaintext values.
   */
  const storedHash = [
    user.passwordHash,
    user.password,
  ].find(isBcryptHash);

  if (!storedHash) {
    throw createError(
      "The user account does not have a valid password hash configured.",
      500,
    );
  }

  const passwordMatches = await bcrypt.compare(
    String(password),
    storedHash,
  );

  if (!passwordMatches) {
    throw createError(
      "Invalid username or password.",
      401,
    );
  }

  validateUserStatus(user);

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return {
    token,
    user: sanitizeUser(user),
  };
};

/* ========================================================
   GET AUTHENTICATED USER
======================================================== */

export const getAuthenticatedUser = async (
  userId,
) => {
  const normalizedId = String(
    userId ?? "",
  ).trim();

  if (!normalizedId) {
    throw createError(
      "User ID is required.",
      400,
    );
  }

  const user = await findUserById(
    normalizedId,
  );

  if (!user) {
    throw createError(
      "Authenticated user was not found.",
      404,
    );
  }

  validateUserStatus(user);

  return sanitizeUser(user);
};

/* ========================================================
   REGISTER USER
======================================================== */

export const registerUser = async (
  data = {},
) => {
  const {
    name,
    email,
    username,
    password,
    phone = "",
    role = "Receptionist",
  } = data;

  const formattedName = String(
    name ?? "",
  ).trim();

  const formattedEmail =
    normalizeEmail(email);

  const formattedUsername =
    normalizeUsername(username);

  const passwordValue = String(
    password ?? "",
  );

  const formattedRole = String(
    role ?? "",
  ).trim();

  /* --------------------------------------------------------
     VALIDATION
  -------------------------------------------------------- */

  if (!formattedName) {
    throw createError(
      "Name is required",
      400,
    );
  }

  if (!formattedEmail) {
    throw createError(
      "Email is required",
      400,
    );
  }

  if (!formattedUsername) {
    throw createError(
      "Username is required",
      400,
    );
  }

  if (!passwordValue) {
    throw createError(
      "Password is required",
      400,
    );
  }

  if (passwordValue.length < 6) {
    throw createError(
      "Password must contain at least 6 characters",
      400,
    );
  }

  if (!ALLOWED_ROLES.includes(formattedRole)) {
    throw createError(
      `Invalid user role. Use ${ALLOWED_ROLES.join(", ")}`,
      400,
    );
  }

  /* --------------------------------------------------------
     CHECK DUPLICATES
  -------------------------------------------------------- */

  const [emailExists, usernameExists] =
    await Promise.all([
      prisma.user.findFirst({
        where: {
          email: {
            equals: formattedEmail,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      }),

      prisma.user.findFirst({
        where: {
          username: {
            equals: formattedUsername,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      }),
    ]);

  if (emailExists) {
    throw createError(
      "Email is already registered",
      409,
    );
  }

  if (usernameExists) {
    throw createError(
      "Username is already registered",
      409,
    );
  }

  /* --------------------------------------------------------
     HASH PASSWORD
  -------------------------------------------------------- */

  const passwordHash = await hashPassword(
    passwordValue,
  );

  const timestamp = getNow();

  /* --------------------------------------------------------
     CREATE USER
  -------------------------------------------------------- */

  try {
    const user = await prisma.user.create({
      data: {
        id: generateUserId(),

        name: formattedName,
        email: formattedEmail,
        username: formattedUsername,
        phone: String(phone ?? "").trim(),

        passwordHash,
        password: null,

        role: formattedRole,
        status: "Active",

        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    return sanitizeUser(user);
  } catch (error) {
    /*
     * Handles uniqueness errors if database
     * unique constraints are added.
     */
    if (error?.code === "P2002") {
      throw createError(
        "Username or email is already registered",
        409,
      );
    }

    throw error;
  }
};

/* ========================================================
   EXPORT
======================================================== */

export default {
  loginUser,
  getAuthenticatedUser,
  hashPassword,
  registerUser,
};
