import "server-only";

/** The two public apps. Staff have their own unlisted sign-in at /staff/sign-in. */
export type Audience = "provider" | "farmer";

export const ROUTES = {
  provider: {
    signIn: "/provider/sign-in",
    signUp: "/provider/sign-up",
    forgot: "/provider/forgot-password",
    verify: "/provider/verify-email",
    reset: "/provider/reset-password",
    /** Where a verified person lands. Setup decides whether they go on to the workspace. */
    home: "/provider/setup",
  },
  farmer: {
    signIn: "/farmer/sign-in",
    signUp: "/farmer/sign-up",
    forgot: "/farmer/forgot-password",
    verify: "/farmer/verify-email",
    reset: "/farmer/reset-password",
    home: "/farmer/home",
  },
} as const;

/** Where this account belongs, whichever sign-in screen it used. */
export function homeForRole(role: string | null | undefined): string {
  if (isStaffRole(role)) return "/staff/providers";
  if (role === "farmer") return ROUTES.farmer.home;
  return ROUTES.provider.home;
}

/** An admin is a member of staff who can also add and remove staff. */
export const isStaffRole = (role: string | null | undefined) => role === "staff" || role === "admin";

/** Accounts the public sign-in screens must treat as unknown, including staff who have left. */
export const isInternalRole = (role: string | null | undefined) => isStaffRole(role) || role === "staff_removed";
