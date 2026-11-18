import { currentUser } from "@/lib/auth";
import { getAnthropicKey } from "@/lib/db";
import { extractCompanies } from "@/lib/discover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 5;
const MAX_BYTES = 4 * 1024 * 1024;

/** Reads company names from uploaded screenshots (multipart field "images"). Nothing is saved. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401 });
  const apiKey = await getAnthropicKey(user.id);
  if (!apiKey) return Response.json({ error: "Add your Anthropic API key in Settings to read screenshots." }, { status: 400 });

  let files: File[];
  try {
    files = (await req.formData()).getAll("images").filter((f): f is File => f instanceof File);
  } catch {
    return Response.json({ error: "Couldn't read the upload." }, { status: 400 });
  }
  if (!files.length) return Response.json({ error: "Add at least one screenshot." }, { status: 400 });
  if (files.length > MAX_IMAGES) return Response.json({ error: `Up to ${MAX_IMAGES} screenshots at a time.` }, { status: 400 });
  for (const f of files) {
    if (!TYPES.has(f.type)) return Response.json({ error: `${f.name}: use a JPEG, PNG or WebP image.` }, { status: 400 });
    if (f.size > MAX_BYTES) return Response.json({ error: `${f.name} is too large.` }, { status: 400 });
  }

  try {
    const images = await Promise.all(
      files.map(async (f) => ({ mediaType: f.type as "image/jpeg" | "image/png" | "image/webp", base64: Buffer.from(await f.arrayBuffer()).toString("base64") })),
    );
    return Response.json({ companies: await extractCompanies(apiKey, images) });
  } catch (e) {
    console.error(`screenshot extraction failed for user ${user.id}:`, (e as Error).message);
    return Response.json({ error: `Couldn't read the screenshots: ${(e as Error).message.slice(0, 200)}` }, { status: 502 });
  }
}
