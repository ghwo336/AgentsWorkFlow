import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const AUTH_REALM = "agent-loop dashboard";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    },
  });
}

function authIsRequired() {
  return process.env.DASHBOARD_AUTH_REQUIRED === "true";
}

function decodeBasicAuth(header: string) {
  const [scheme, value] = header.split(" ");
  if (scheme !== "Basic" || !value) return null;

  try {
    const decoded = atob(value);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!authIsRequired()) return NextResponse.next();

  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Dashboard authentication is not configured", {
      status: 503,
    });
  }

  const credentials = decodeBasicAuth(request.headers.get("authorization") ?? "");
  if (
    credentials?.username === expectedUsername &&
    credentials.password === expectedPassword
  ) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
