import { NextRequest } from "next/server";
import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyToApi(request as unknown as Request, "/api/v1/food-safety/stats");
}

export async function POST(request: NextRequest) {
  return proxyToApi(request as unknown as Request, "/api/v1/food-safety/inbox");
}
