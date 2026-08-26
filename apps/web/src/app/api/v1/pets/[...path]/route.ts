import { NextRequest } from "next/server";
import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = "/api/v1/" + path.join("/");
  return proxyToApi(request as unknown as Request, pathname);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = "/api/v1/" + path.join("/");
  return proxyToApi(request as unknown as Request, pathname);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = "/api/v1/" + path.join("/");
  return proxyToApi(request as unknown as Request, pathname);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = "/api/v1/" + path.join("/");
  return proxyToApi(request as unknown as Request, pathname);
}
