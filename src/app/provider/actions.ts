"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth, OTP_LENGTH } from "@/lib/auth";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { clearPending, getPending, setPending } from "@/lib/pending";

export type FormState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed back so the form keeps what the person typed (never passwords or codes). */
  values?: Record<string, string>;
};

const SIGN_IN = "/provider/sign-in";
const VERIFY = "/provider/verify-email";
const SETUP = "/provider/setup";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128, "Use 128 characters or fewer");

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function codeOf(err: unknown): string | undefined {
  return err instanceof APIError ? (err.body as { code?: string } | undefined)?.code : undefined;
}

function otpMessage(err: unknown): string {
  switch (codeOf(err)) {
    case "OTP_EXPIRED":
      return "That code has expired. Request a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong tries. Request a new code.";
    case "INVALID_OTP":
      return "That code is incorrect. Check it and try again.";
    default:
      return "That code didn't work. Request a new one and try again.";
  }
}

function isRateLimited(err: unknown) {
  return err instanceof APIError && (err.statusCode === 429 || String(err.status) === "TOO_MANY_REQUESTS");
}

/* ------------------------------------------------------------------ sign up */

const signUpSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(100, "Use 100 characters or fewer"),
  phone: z.string().trim().min(1, "Enter your phone number"),
  email: emailSchema,
  password: passwordSchema,
});

export async function signUpProvider(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = {
    businessName: str(fd, "businessName"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    password: str(fd, "password"),
  };
  const values = { businessName: raw.businessName, phone: raw.phone, email: raw.email };

  const parsed = signUpSchema.safeParse(raw);
  const fieldErrors = parsed.success ? {} : fieldErrorsFrom(parsed.error);
  const phone = normaliseSierraLeonePhone(raw.phone);
  if (!phone && !fieldErrors.phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (!parsed.success || !phone) return { fieldErrors, values };

  try {
    await auth.api.signUpEmail({
      body: {
        name: parsed.data.businessName,
        email: parsed.data.email,
        password: parsed.data.password,
        phone,
        businessName: parsed.data.businessName,
      },
      headers: await headers(),
    });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    // Same wording whether or not the email is already registered.
    if (codeOf(err)?.startsWith("USER_ALREADY_EXISTS") || codeOf(err) === "USER_ALREADY_EXISTS") {
      return {
        error: "We couldn't create an account with these details. If you already have one, sign in instead.",
        values,
      };
    }
    return { error: "Something went wrong creating your account. Please try again.", values };
  }

  await setPending({ email: parsed.data.email, purpose: "verify" });
  redirect(VERIFY);
}

/* ------------------------------------------------------------------ sign in */

export async function signInProvider(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(str(fd, "email"));
  const password = str(fd, "password");
  const values = { email: str(fd, "email") };
  if (!email.success) return { fieldErrors: { email: "Enter a valid email address" }, values };
  if (!password) return { fieldErrors: { password: "Enter your password" }, values };

  let needsVerification = false;
  try {
    await auth.api.signInEmail({ body: { email: email.data, password }, headers: await headers() });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    if (codeOf(err) === "EMAIL_NOT_VERIFIED") needsVerification = true;
    else return { error: "Incorrect email or password.", values };
  }

  if (needsVerification) {
    // Better Auth has already emailed a fresh code for the unverified account.
    await setPending({ email: email.data, purpose: "verify" });
    redirect(VERIFY);
  }
  redirect(SETUP);
}

/* ---------------------------------------------------------- forgot password */

export async function requestPasswordReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(str(fd, "email"));
  const values = { email: str(fd, "email") };
  if (!email.success) return { fieldErrors: { email: "Enter a valid email address" }, values };

  try {
    await auth.api.requestPasswordResetEmailOTP({ body: { email: email.data } });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    // Anything else is swallowed: the screen must not reveal whether an account exists.
  }
  await setPending({ email: email.data, purpose: "reset" });
  redirect(VERIFY);
}

/* ------------------------------------------------------------ verify a code */

export async function verifyCode(_prev: FormState, fd: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending) redirect(SIGN_IN);

  const code = (str(fd, "code") || str(fd, "codeFallback")).replace(/\D/g, "");
  if (code.length !== OTP_LENGTH) return { fieldErrors: { code: `Enter the ${OTP_LENGTH}-digit code from your email` } };

  try {
    if (pending.purpose === "verify") {
      await auth.api.verifyEmailOTP({ body: { email: pending.email, otp: code }, headers: await headers() });
    } else {
      await auth.api.checkVerificationOTP({ body: { email: pending.email, otp: code, type: "forget-password" } });
    }
  } catch (err) {
    return { fieldErrors: { code: otpMessage(err) } };
  }

  if (pending.purpose === "verify") {
    await clearPending();
    redirect(SETUP); // verified and signed in, so setup can resume
  }
  await setPending({ ...pending, code });
  redirect("/provider/reset-password");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resendCode(_prev: FormState, _fd: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending) redirect(SIGN_IN);
  try {
    if (pending.purpose === "verify") {
      await auth.api.sendVerificationOTP({ body: { email: pending.email, type: "email-verification" } });
    } else {
      await auth.api.requestPasswordResetEmailOTP({ body: { email: pending.email } });
    }
  } catch (err) {
    if (isRateLimited(err)) return { error: "Please wait a minute before asking for another code." };
    return { error: "We couldn't send a new code. Please try again shortly." };
  }
  return { notice: "If that email can receive a code, a new one is on its way." };
}

/* ----------------------------------------------------------- reset password */

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export async function resetPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending || pending.purpose !== "reset" || !pending.code) redirect(SIGN_IN);

  const parsed = resetSchema.safeParse({ password: str(fd, "password"), confirm: str(fd, "confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await auth.api.resetPasswordEmailOTP({
      body: { email: pending.email, otp: pending.code, password: parsed.data.password },
    });
  } catch (err) {
    if (["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(codeOf(err) ?? "")) {
      await clearPending();
      redirect("/provider/forgot-password?expired=1");
    }
    return { error: "We couldn't reset your password. Please try again." };
  }

  await clearPending();
  redirect(`${SIGN_IN}?reset=1`);
}

/* ---------------------------------------------------------------- sign out */

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect(SIGN_IN);
}
