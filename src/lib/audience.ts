import "server-only";

/** The two apps. Staff use the provider screens to sign in and are routed on from there. */
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
  if (role === "staff") return "/staff/providers";
  if (role === "farmer") return ROUTES.farmer.home;
  return ROUTES.provider.home;
}
