import { NextResponse } from "next/server";
import { errorMessage } from "./async";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Recurso não encontrado."): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function serviceUnavailable(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 503 });
}

/** Wrap a route handler so unexpected errors become a clean 500. */
export async function route(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    console.error("[api] erro não tratado:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
