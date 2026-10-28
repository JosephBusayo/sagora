import "server-only";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { notify } from "./outbox";

/** Length of every emailed code. The design shows seven boxes. */
export const OTP_LENGTH = 7;
/** Codes expire after 10 minutes and allow 5 wrong tries. */
const OTP_TTL_SECONDS = 600;

const SUBJECTS = {
  "email-verification": "Confirm your Sagora email",
  "forget-password": "Reset your Sagora password",
  "sign-in": "Your Sagora sign-in code",
  "change-email": "Confirm your new Sagora email",
} as const;

export const auth = betterAuth({
  appName: "Sagora",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  // SQLite keeps local development free and simple. Production moves to Postgres:
  // swap this one line for a `pg` Pool (Better Auth supports both).
  database: db,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Unverified accounts cannot sign in, so they cannot reach setup.
    requireEmailVerification: true,
    autoSignIn: false,
    // "Reset access while another browser is signed in; the old session must fail."
    revokeSessionsOnPasswordReset: true,
  },

  emailVerification: {
    // Sign in right after the code is accepted, so setup can resume.
    autoSignInAfterVerification: true,
  },

  user: {
    additionalFields: {
      // Provided at sign-up (provider form). Normalised to +232XXXXXXXX before saving.
      phone: { type: "string", required: false, input: true },
      businessName: { type: "string", required: false, input: true },
      // Never settable from the client. Farmer accounts will be added in a later stage.
      role: { type: "string", required: false, defaultValue: "provider", input: false },
    },
  },

  plugins: [
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: OTP_TTL_SECONDS,
      allowedAttempts: 5,
      storeOTP: "hashed",
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        // Saved to the outbox, which then sends. Sign-up never fails because email did.
        notify({
          kind: `otp.${type}`,
          to: email,
          subject: SUBJECTS[type],
          text:
            `Your Sagora code is ${otp}\n\n` +
            `It expires in ${OTP_TTL_SECONDS / 60} minutes. ` +
            `If you did not ask for this, you can ignore this email.`,
        });
      },
    }),
    nextCookies(), // keep last: lets server actions set the session cookie
  ],
});

export type Session = typeof auth.$Infer.Session;
