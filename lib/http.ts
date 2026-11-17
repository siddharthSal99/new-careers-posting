const UA = "Mozilla/5.0 (compatible; new-careers-posting/1.0; personal job tracker)";

export async function fetchWithTimeout(url: string, ms = 30_000, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T>(url: string, ms?: number): Promise<T> {
  const res = await fetchWithTimeout(url, ms, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${url}`);
  return (await res.json()) as T;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Very small HTML-to-text conversion for job descriptions. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, "\n")
      .replace(/<li>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", trade: "™", copy: "©", reg: "®",
  eacute: "é", egrave: "è", aacute: "á", oacute: "ó", uacute: "ú", iacute: "í", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
  euro: "€", pound: "£", times: "×", rarr: "→", larr: "←", shy: "",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => (name.toLowerCase() === "amp" ? m : (NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m)))
    // Last, so "&amp;lt;" becomes "&lt;" rather than "<".
    .replace(/&amp;/g, "&");
}
