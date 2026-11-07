import { runDaily } from "@/lib/run";

export const dynamic = "force-dynamic";
// Fetching large boards and scoring jobs can take a while.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const summary = await runDaily();
  return Response.json(summary);
}
