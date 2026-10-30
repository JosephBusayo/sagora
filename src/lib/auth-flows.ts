import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth, OTP_LENGTH } from "./auth";
import { clearFor } from "./mfa";
import { db } from "./db";
import { normaliseSierraLeonePhone } from "./phone";
import { clearPending, getPending, setPending } from "./pending";
import { ROUTES, homeForRole, isInternalRole, isStaffRole, type Audience } from "./audience";

/**
 * The sign-up / sign-in / recovery flow, shared by the provider and farmer screens.
 * The two differ only in the first field (business name vs person's name), the role the
 * account gets, and where each step redirects. Keeping one copy means a fix to the rules
 * (neutral errors, rate limits, session handling) applies to both apps at once.
 *
 * These are plain functions. Each app wraps them in its own "use server" file.
 */

export type FormState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed back so the form keeps what the person typed (never passwords or codes). */
  values?: Record<string, string>;
};

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

async function roleOf(email: string): Promise<string | null> {
  const row = (await db.get(`SELECT role FROM "user" WHERE email = ?`, email)) as { role?: string } | undefined;
  return row?.role ?? null;
}

/* ------------------------------------------------------------------ sign up */

const nameSchema = z.string().trim().min(2).max(100);

/**
 * `nameLabel` only changes the wording of the error, so each screen can name its own
 * first field ("business name" for providers, "name" for farmers).
 */
export async function signUp(audience: Audience, fd: FormData, nameLabel: string): Promise<FormState> {
  const r = ROUTES[audience];
  const raw = {
    name: str(fd, audience === "provider" ? "businessName" : "name").trim(),
    phone: str(fd, "phone").trim(),
    email: str(fd, "email"),
    password: str(fd, "password"),
  };
  const nameKey = audience === "provider" ? "businessName" : "name";
  const values = { [nameKey]: raw.name, phone: raw.phone, email: raw.email.trim() };

  const fieldErrors: Record<string, string> = {};
  if (!nameSchema.safeParse(raw.name).success) fieldErrors[nameKey] = `Enter your ${nameLabel}`;
  const parsedEmail = emailSchema.safeParse(raw.email);
  if (!parsedEmail.success) fieldErrors.email = "Enter a valid email address";
  const parsedPassword = passwordSchema.safeParse(raw.password);
  if (!parsedPassword.success) fieldErrors.password = fieldErrorsFrom(parsedPassword.error).form ?? "Use at least 8 characters";
  const phone = normaliseSierraLeonePhone(raw.phone);
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const email = parsedEmail.data!;
  try {
    await auth.api.signUpEmail({
      body: {
        name: raw.name,
        email,
        password: raw.password,
        phone: phone!,
        // Providers carry a business name; farmers do not.
        ...(audience === "provider" ? { businessName: raw.name } : {}),
      },
      headers: await headers(),
    });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    // Same wording whether or not the email is already registered.
    if (codeOf(err)?.startsWith("USER_ALREADY_EXISTS")) {
      return { error: "We couldn't create an account with these details. If you already have one, sign in instead.", values };
    }
    return { error: "Something went wrong creating your account. Please try again.", values };
  }

  // `role` is never settable from the client, so a farmer account is marked here.
  if (audience === "farmer") await db.run(`UPDATE "user" SET role = 'farmer' WHERE email = ?`, email);

  await setPending({ email, purpose: "verify", audience });
  redirect(r.verify);
}

/* ------------------------------------------------------------------ sign in */

export async function signIn(audience: Audience, fd: FormData): Promise<FormState> {
  const r = ROUTES[audience];
  const parsed = emailSchema.safeParse(str(fd, "email"));
  const password = str(fd, "password");
  const values = { email: str(fd, "email") };
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address" }, values };
  if (!password) return { fieldErrors: { password: "Enter your password" }, values };
  const email = parsed.data;

  // Staff do not sign in here, and this screen does not reveal that they exist.
  if (isInternalRole(await roleOf(email))) return { error: "Incorrect email or password.", values };

  let needsVerification = false;
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    if (codeOf(err) === "EMAIL_NOT_VERIFIED") needsVerification = true;
    else return { error: "Incorrect email or password.", values };
  }

  if (needsVerification) {
    // The code from sign-up has usually expired by now, so this screen needs a fresh one. Better
    // Auth does not send one here by itself. A failed send still lands on the screen with Resend.
    await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } }).catch(() => {});
    await setPending({ email, purpose: "verify", audience });
    redirect(r.verify);
  }
  // Someone may sign in on the wrong screen: send them where their account belongs.
  redirect(homeForRole(await roleOf(email)));
}

/** The staff door. Every failure reads the same, so it does not confirm who is staff. */
export async function signInStaff(fd: FormData): Promise<FormState> {
  const email = str(fd, "email").trim().toLowerCase();
  const password = str(fd, "password");
  const values = { email };
  const refused = { error: "Incorrect email or password.", values };
  if (!isStaffRole(await roleOf(email))) return refused;
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    return isRateLimited(err) ? { error: "Too many attempts. Please wait a minute and try again.", values } : refused;
  }
  redirect("/staff/verify");
}

/* ---------------------------------------------------------- forgot password */

export async function requestPasswordReset(audience: Audience, fd: FormData): Promise<FormState> {
  const r = ROUTES[audience];
  const parsed = emailSchema.safeParse(str(fd, "email"));
  const values = { email: str(fd, "email") };
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address" }, values };

  try {
    await auth.api.requestPasswordResetEmailOTP({ body: { email: parsed.data } });
  } catch (err) {
    if (isRateLimited(err)) return { error: "Too many attempts. Please wait a minute and try again.", values };
    // Anything else is swallowed: the screen must not reveal whether an account exists.
  }
  await setPending({ email: parsed.data, purpose: "reset", audience });
  redirect(r.verify);
}

/* ------------------------------------------------------------ verify a code */

export async function verifyCode(fd: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending) redirect(ROUTES.provider.signIn);
  const r = ROUTES[pending.audience ?? "provider"];

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
    redirect(homeForRole(await roleOf(pending.email))); // verified and signed in
  }
  await setPending({ ...pending, code });
  redirect(r.reset);
}

export async function resendCode(): Promise<FormState> {
  const pending = await getPending();
  if (!pending) redirect(ROUTES.provider.signIn);
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

export async function resetPassword(fd: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending || pending.purpose !== "reset" || !pending.code) redirect(ROUTES.provider.signIn);
  const r = ROUTES[pending.audience ?? "provider"];

  const parsed = resetSchema.safeParse({ password: str(fd, "password"), confirm: str(fd, "confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await auth.api.resetPasswordEmailOTP({
      body: { email: pending.email, otp: pending.code, password: parsed.data.password },
    });
  } catch (err) {
    if (["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(codeOf(err) ?? "")) {
      await clearPending();
      redirect(`${r.forgot}?expired=1`);
    }
    return { error: "We couldn't reset your password. Please try again." };
  }

  await clearPending();
  redirect(`${r.signIn}?reset=1`);
}

/* ---------------------------------------------------------------- sign out */

export async function signOutTo(audience: Audience) {
  // The staff second factor belongs to the session, so signing out must end it too — otherwise
  // the next person to sign in on this machine inherits a browser that is already verified.
  const s = await auth.api.getSession({ headers: await headers() });
  if (s?.session.id) await clearFor(s.session.id);
  await auth.api.signOut({ headers: await headers() });
  redirect(ROUTES[audience].signIn);
}
