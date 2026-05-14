import { auth } from "../../../auth";
import { getToken } from "next-auth/jwt";

async function getUserId(request) {
  const session = await auth();
  if (session?.user?.id) {
    return session.user.id;
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.url.startsWith("https://"),
  });
  return token?.sub || token?.id || null;
}

async function proxy(request, context) {
  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const path = (await context.params).path.join("/");
  const incomingUrl = new URL(request.url);
  const backendBase =
    process.env.INTERNAL_BACKEND_URL ||
    (process.env.API_URL ? `${process.env.API_URL.replace(/\/$/, "")}/api` : `${incomingUrl.origin}/backend/api`);
  const target = new URL(`${backendBase}/${path}`);
  target.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.set("x-user-id", userId);
  headers.set("x-internal-api-secret", process.env.INTERNAL_API_SECRET || "local-dev-secret");
  headers.delete("host");
  headers.delete("connection");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(target, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
