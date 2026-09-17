// MHTML de Jira -> Markdown, incluidas las imágenes relevantes embebidas en MIME.
import * as path from "path";
import { ConvertResult, GeneratedAsset } from "./types";

type Child = HtmlNode | string;
type MimePart = { headers: Map<string, string>; body: string };
type ImagePart = { contentType: string; content: Buffer };

type HtmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: Child[];
};

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr",
]);
const SKIP_TAGS = new Set(["script", "style", "nav", "noscript", "svg"]);

const INSTRUCTION_LABELS = [
  "Instrucciones para certificación",
  "Instrucciones para producción",
  "Instrucciones post deploy",
  "Instrucciones para reversión",
  "Instrucciones Automatizadas",
];

/** El cuerpo de la descripción se rinde aparte, en su propia sección. */
const DESCRIPTION_ID = "descriptionArea";

const TEMPLATE_ONLY_TEXT = [
  "certificación",
  "producción",
  "post deploy",
  "monitoreo sintético",
  "reversión",
  "automatizadas",
  "colocar instrucciones a partir de aquí",
  "no borrar el título",
];

function normalizeLines(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function parseHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";
  for (const line of normalizeLines(raw).split("\n")) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ""} ${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    current = line.slice(0, colon).trim().toLowerCase();
    headers.set(current, line.slice(colon + 1).trim());
  }
  return headers;
}

function splitHeadBody(raw: string): { headers: Map<string, string>; body: string } {
  const normalized = normalizeLines(raw).replace(/^\n+/, "");
  const split = normalized.indexOf("\n\n");
  if (split < 0) return { headers: parseHeaders(normalized), body: "" };
  return { headers: parseHeaders(normalized.slice(0, split)), body: normalized.slice(split + 2) };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMhtml(raw: string): { headers: Map<string, string>; parts: MimePart[] } {
  const top = splitHeadBody(raw);
  const contentType = top.headers.get("content-type") ?? "";
  const boundaryMatch = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundaryMatch) throw new Error("El MHTML no declara un boundary MIME.");
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const delimiter = new RegExp(`^--${escapeRegExp(boundary)}(?:--)?[ \\t]*$`, "gm");
  const markers = [...top.body.matchAll(delimiter)];
  const parts: MimePart[] = [];
  for (let i = 0; i < markers.length - 1; i++) {
    const marker = markers[i];
    if (marker[0].startsWith(`--${boundary}--`)) break;
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[i + 1].index ?? top.body.length;
    const parsed = splitHeadBody(top.body.slice(start, end));
    parts.push(parsed);
  }
  if (!parts.length) throw new Error("El MHTML no contiene partes MIME.");
  return { headers: top.headers, parts };
}

function decodeQuotedPrintable(body: string): Buffer {
  const compact = normalizeLines(body).replace(/=\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < compact.length; i++) {
    if (compact[i] === "=" && /^[0-9a-f]{2}$/i.test(compact.slice(i + 1, i + 3))) {
      bytes.push(parseInt(compact.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    const char = compact[i];
    const encoded = Buffer.from(char, "utf8");
    bytes.push(...encoded);
  }
  return Buffer.from(bytes);
}

function decodeMimeBody(part: MimePart): Buffer {
  const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (encoding === "base64") return Buffer.from(part.body.replace(/\s+/g, ""), "base64");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(part.body);
  return Buffer.from(part.body, "utf8");
}

function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_all, charset, mode, data) => {
    const bytes = mode.toLowerCase() === "b"
      ? Buffer.from(data, "base64")
      : decodeQuotedPrintable(data.replace(/_/g, " "));
    if (/^utf-?8$/i.test(charset) || /^us-ascii$/i.test(charset)) return bytes.toString("utf8");
    return bytes.toString("latin1");
  });
}

function htmlUnescape(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    rarr: "→", larr: "←", bull: "•", middot: "·", ndash: "–", mdash: "—", hellip: "…",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source))) {
    attrs[match[1].toLowerCase()] = htmlUnescape(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "document", attrs: {}, children: [] };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(html))) {
    const value = token[0];
    if (value.startsWith("<!--") || /^<!/i.test(value)) continue;
    if (!value.startsWith("<")) {
      stack[stack.length - 1].children.push(htmlUnescape(value));
      continue;
    }
    const close = /^<\/\s*([^\s>]+)/.exec(value);
    if (close) {
      const tag = close[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i);
          break;
        }
      }
      continue;
    }
    const open = /^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/.exec(value);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const node: HtmlNode = { tag, attrs: parseAttrs(open[2]), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(value)) stack.push(node);
  }
  return root;
}

function* walk(node: HtmlNode): Generator<HtmlNode> {
  yield node;
  for (const child of node.children) if (typeof child !== "string") yield* walk(child);
}

function plainText(node: HtmlNode): string {
  const blocks = new Set(["address", "blockquote", "br", "div", "h1", "h2", "h3", "h4", "li", "p", "pre", "td", "th", "tr"]);
  const pieces: string[] = [];
  for (const child of node.children) {
    if (typeof child === "string") pieces.push(child);
    else {
      if (blocks.has(child.tag)) pieces.push("\n");
      pieces.push(plainText(child));
      if (blocks.has(child.tag)) pieces.push("\n");
    }
  }
  return pieces.join("").replace(/\s+/g, " ").trim();
}

function findById(root: HtmlNode, id: string): HtmlNode | undefined {
  for (const node of walk(root)) if (node.attrs.id === id) return node;
  return undefined;
}

/** Pares etiqueta/valor de las tablas de la incidencia, en orden de documento. Una
 *  etiqueta es una celda cuyo texto acaba en ":"; así las filas de datos de las tablas
 *  anidadas (enlaces, subtareas) no se confunden con campos. No se desciende dentro de
 *  una fila ya reconocida, de modo que el valor conserva su tabla interna intacta. */
function fieldNodes(root: HtmlNode): Array<[string, HtmlNode]> {
  const fields: Array<[string, HtmlNode]> = [];
  const visit = (node: HtmlNode): void => {
    if (node.tag === "tr") {
      const cells = node.children.filter(
        (child): child is HtmlNode => typeof child !== "string" && (child.tag === "td" || child.tag === "th")
      );
      if (cells.length === 2 || cells.length === 4) {
        let found = false;
        for (let i = 0; i < cells.length; i += 2) {
          const raw = plainText(cells[i]);
          if (!/:\s*$/.test(raw)) continue;
          const label = raw.replace(/:\s*$/, "").trim();
          if (!label || label.length > 80) continue;
          found = true;
          if (plainText(cells[i + 1])) fields.push([label, cells[i + 1]]);
        }
        if (found) return;
      }
    }
    for (const child of node.children) if (typeof child !== "string") visit(child);
  };
  visit(root);
  return fields;
}

function hasMeaningfulInstruction(node: HtmlNode): boolean {
  let text = plainText(node).toLocaleLowerCase("es");
  for (const template of TEMPLATE_ONLY_TEXT) {
    text = text.split(template.toLocaleLowerCase("es")).join(" ");
  }
  return /[a-záéíóúüñ0-9]/i.test(text);
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[ .]+$/, "").trim() || "imagen";
}

function encodeMdPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

class MarkdownRenderer {
  constructor(private readonly images: Map<string, string>, private readonly headingOffset = 3) {}

  render(node: HtmlNode): string {
    let result = this.renderNode(node).replace(/\r/g, "");
    result = result.split("\n").map((line) => line.trimEnd()).join("\n");
    result = result.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
    return result.trim();
  }

  private children(node: HtmlNode): string {
    return node.children
      .map((child) => (typeof child === "string" ? child.replace(/[\s\u00a0]+/g, " ") : this.renderNode(child)))
      .join("");
  }

  private renderNode(node: HtmlNode): string {
    const tag = node.tag;
    if (SKIP_TAGS.has(tag)) return "";
    if (tag === "br") return "\n\n";
    if (tag === "hr") return "\n\n---\n\n";
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(6, Number(tag[1]) + this.headingOffset);
      return `\n\n${"#".repeat(level)} ${this.children(node).trim()}\n\n`;
    }
    if (["p", "div", "section", "article", "blockquote"].includes(tag)) {
      let content = this.children(node).trim();
      if (!content) return "";
      if (tag === "blockquote") content = content.split("\n").map((line) => `> ${line}`).join("\n");
      return `\n\n${content}\n\n`;
    }
    if (tag === "strong" || tag === "b") {
      const content = this.children(node).trim();
      return content ? `**${content}**` : "";
    }
    if (tag === "em" || tag === "i") {
      const content = this.children(node).trim();
      return content ? `*${content}*` : "";
    }
    if (["del", "s", "strike"].includes(tag)) {
      const content = this.children(node).trim();
      return content ? `~~${content}~~` : "";
    }
    if (tag === "code") return `\`${this.children(node).trim().replace(/`/g, "\\`")}\``;
    if (tag === "pre") return `\n\n\`\`\`\n${plainText(node)}\n\`\`\`\n\n`;
    if (tag === "a") {
      const content = this.children(node).trim();
      const href = node.attrs.href?.trim();
      return href ? `[${content || href}](${href.replace(/ /g, "%20")})` : content;
    }
    if (tag === "img") {
      const link = this.images.get(node.attrs.src ?? "");
      if (!link) return "";
      const alt = (node.attrs.alt || "Imagen").replace(/]/g, "\\]");
      return `\n\n![${alt}](${link})\n\n`;
    }
    if (tag === "ul" || tag === "ol") {
      const items = node.children.filter((child): child is HtmlNode => typeof child !== "string" && child.tag === "li");
      const parsedStart = Number.parseInt(node.attrs.start || "1", 10);
      const start = Number.isFinite(parsedStart) ? parsedStart : 1;
      const lines = items.map((item, index) => {
        const parsedValue = Number.parseInt(item.attrs.value || String(start + index), 10);
        const number = Number.isFinite(parsedValue) ? parsedValue : start + index;
        const prefix = tag === "ol" ? `${number}. ` : "- ";
        return prefix + this.children(item).trim().replace(/\n+/g, "\n  ");
      });
      return `\n\n${lines.join("\n")}\n\n`;
    }
    if (tag === "li") return this.children(node);
    if (tag === "table") return this.renderTable(node);
    return this.children(node);
  }

  /** Tabla de "Enlaces de incidencias": filas de una celda (el grupo, p. ej. "Test")
   *  seguidas de filas relación/clave/resumen/estado. Se aplana con el grupo como columna. */
  private renderLinksTable(rows: string[][]): string | undefined {
    const datos = rows.filter((row) => row.length > 1);
    if (!datos.length || !rows.some((row) => row.length === 1) || datos.some((row) => row.length !== 4)) {
      return undefined;
    }
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const out = [line(["Grupo", "Relación", "Incidencia", "Resumen", "Estado"]), line(Array(5).fill("---"))];
    let grupo = "";
    for (const row of rows) {
      if (row.length === 1) grupo = row[0].replace(/^\*\*(.*)\*\*$/, "$1");
      else out.push(line([grupo, ...row]));
    }
    return `\n\n${out.join("\n")}\n\n`;
  }

  private renderTable(table: HtmlNode): string {
    const rows: string[][] = [];
    const visit = (node: HtmlNode) => {
      if (node !== table && node.tag === "table") return;
      if (node.tag === "tr") {
        const cells = node.children.filter(
          (child): child is HtmlNode => typeof child !== "string" && (child.tag === "td" || child.tag === "th")
        );
        if (cells.length) rows.push(cells.map((cell) => this.render(cell).replace(/\|/g, "\\|").replace(/\n+/g, "<br>")));
        return;
      }
      for (const child of node.children) if (typeof child !== "string") visit(child);
    };
    visit(table);
    if (!rows.length) return "";
    const enlaces = this.renderLinksTable(rows);
    if (enlaces) return enlaces;
    // La fila de títulos ya se distingue por ser el encabezado: la negrita sobra.
    rows[0] = rows[0].map((cell) => cell.replace(/^\*\*(.*)\*\*$/, "$1"));
    const width = Math.max(...rows.map((row) => row.length));
    const padded = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return `\n\n${[line(padded[0]), line(Array(width).fill("---")), ...padded.slice(1).map(line)].join("\n")}\n\n`;
  }
}

function imageExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/svg+xml": ".svg", "image/webp": ".webp",
  };
  return map[contentType.toLowerCase()] ?? ".bin";
}

function selectFields(root: HtmlNode): {
  context: Array<[string, HtmlNode]>;
  instructions: Array<[string, HtmlNode]>;
  window: Array<[string, HtmlNode]>;
} {
  const first = new Map<string, HtmlNode>();
  for (const [label, node] of fieldNodes(root)) if (!first.has(label)) first.set(label, node);
  const esVentana = (label: string) => label.startsWith("Inicio de ") || label.startsWith("Fin de ");
  const context = [...first.entries()].filter(
    ([label, node]) =>
      !INSTRUCTION_LABELS.includes(label) &&
      !esVentana(label) &&
      ![...walk(node)].some((n) => n.attrs.id === DESCRIPTION_ID)
  );
  const instructions = INSTRUCTION_LABELS.flatMap((label) => {
    const node = first.get(label);
    return node && hasMeaningfulInstruction(node) ? [[label, node] as [string, HtmlNode]] : [];
  });
  const window = [...first.entries()].filter(([label]) => esVentana(label));
  return { context, instructions, window };
}

/** Clave, enlace y resumen de la incidencia, tomados del título de la vista de Jira. */
function issueTitle(root: HtmlNode): { node?: HtmlNode; key: string; url: string; summary: string } {
  const node = [...walk(root)].find((n) => n.tag === "h3" && (n.attrs.class ?? "").includes("formtitle"));
  const link = node && [...walk(node)].find((n) => n.tag === "a" && /\/browse\/[A-Z][A-Z0-9_]*-\d+/.test(n.attrs.href ?? ""));
  const url = link?.attrs.href?.trim() ?? "";
  const key = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/.exec(url)?.[1] ?? "";
  return { node, key, url, summary: link ? plainText(link) : "" };
}

/** Clave de la incidencia y fechas del título ("Creada: … Actualizada: …"). */
function issueHeader(root: HtmlNode): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const title = issueTitle(root);
  if (!title.node) return out;
  if (title.key) out.push(["Clave", `[${title.key}](${title.url})`]);
  const texto = plainText(title.node);
  for (const etiqueta of ["Creada", "Actualizada", "Resuelta", "Created", "Updated", "Resolved"]) {
    const m = new RegExp(`${etiqueta}:\\s*(\\S+(?: \\d{1,2}:\\d{2}(?: [AP]M)?)?)`).exec(texto);
    if (m) out.push([etiqueta, m[1]]);
  }
  return out;
}

function extractImages(
  nodes: HtmlNode[],
  imageParts: Map<string, ImagePart>,
  outPath: string
): { links: Map<string, string>; assets: GeneratedAsset[] } {
  const references: Array<{ src: string; alt: string }> = [];
  const seen = new Set<string>();
  for (const content of nodes) {
    for (const node of walk(content)) {
      if (node.tag !== "img") continue;
      const src = node.attrs.src?.trim();
      const alt = node.attrs.alt?.trim();
      if (!src || !alt || seen.has(src)) continue; // omite avatares/iconos de Jira
      seen.add(src);
      references.push({ src, alt });
    }
  }
  const assetDir = `${path.basename(outPath, path.extname(outPath))}_assets`;
  const used = new Set<string>();
  const links = new Map<string, string>();
  const assets: GeneratedAsset[] = [];
  for (const { src, alt } of references) {
    const image = imageParts.get(src);
    if (!image) throw new Error(`La imagen referenciada no existe en el MHTML: ${src}`);
    let candidate = safeName(path.basename(alt));
    if (!path.extname(candidate)) candidate += imageExtension(image.contentType);
    const parsed = path.parse(candidate);
    let unique = candidate;
    let counter = 2;
    while (used.has(unique.toLocaleLowerCase())) unique = `${parsed.name}-${counter++}${parsed.ext}`;
    used.add(unique.toLocaleLowerCase());
    const relativePath = path.join(assetDir, unique);
    assets.push({ relativePath, content: image.content });
    links.set(src, encodeMdPath(relativePath.replace(/\\/g, "/")));
  }
  return { links, assets };
}

function loadIssue(raw: string): { mime: ReturnType<typeof parseMhtml>; htmlPart: MimePart; root: HtmlNode } {
  const mime = parseMhtml(raw);
  const htmlPart = mime.parts.find((part) => (part.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html"));
  if (!htmlPart) throw new Error("El MHTML no contiene una parte text/html.");
  return { mime, htmlPart, root: parseHtml(decodeMimeBody(htmlPart).toString("utf8")) };
}

/** Incidencia de Jira ya estructurada, en texto plano, para conversores que no generan Markdown. */
export interface JiraIssue {
  key: string;
  url: string;
  summary: string;
  /** Campos de contexto por etiqueta ("Informador", "QE"…), sin los de instrucciones. */
  fields: Map<string, string>;
  description: string;
  /** Secciones de instrucciones con contenido real, por etiqueta. */
  instructions: Map<string, string>;
}

export function readJiraIssue(raw: string): JiraIssue {
  const { mime, root } = loadIssue(raw);
  const title = issueTitle(root);
  const subject = decodeMimeWords(mime.headers.get("subject") ?? "").trim();
  const { context, instructions } = selectFields(root);
  const description = findById(root, DESCRIPTION_ID);
  return {
    key: title.key || (/\b([A-Z][A-Z0-9_]*-\d+)\b/.exec(subject)?.[1] ?? ""),
    url: title.url,
    summary: title.summary || subject.replace(/^\[#?[A-Z][A-Z0-9_]*-\d+\]\s*/, ""),
    fields: new Map(context.map(([label, node]) => [label, plainText(node)])),
    description: description ? plainText(description) : "",
    instructions: new Map(instructions.map(([label, node]) => [label, plainText(node)])),
  };
}

/** Convierte el texto completo de un MHTML exportado por Jira. */
export function mhtmlToMd(raw: string, outPath: string): ConvertResult {
  const { mime, htmlPart, root } = loadIssue(raw);
  const subject = decodeMimeWords(mime.headers.get("subject") ?? "").trim() || path.basename(outPath, path.extname(outPath));
  const sourceUrl = htmlPart.headers.get("content-location")?.trim() ?? "";

  const imageParts = new Map<string, ImagePart>();
  for (const part of mime.parts) {
    const contentType = (part.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) continue;
    const image = { contentType, content: decodeMimeBody(part) };
    const location = part.headers.get("content-location")?.trim();
    const contentId = part.headers.get("content-id")?.trim().replace(/^<|>$/g, "");
    if (location) imageParts.set(location, image);
    if (contentId) imageParts.set(`cid:${contentId}`, image);
  }

  const { context, instructions, window } = selectFields(root);
  const description = findById(root, DESCRIPTION_ID);
  // Los campos de contexto solo traen iconos y avatares de Jira: no aportan imágenes.
  const selectedNodes = [...instructions, ...window].map(([, node]) => node);
  if (description) selectedNodes.push(description);
  const { links, assets } = extractImages(selectedNodes, imageParts, outPath);
  const renderer = new MarkdownRenderer(links);
  const lines = [`# ${subject}`];
  if (sourceUrl) lines.push("", `Fuente: [${sourceUrl}](${sourceUrl})`);
  const cabecera = issueHeader(root);
  if (context.length || cabecera.length) {
    lines.push("", "## Contexto", "");
    for (const [label, value] of cabecera) lines.push(`- **${label}:** ${value}`);
    for (const [label, node] of context) {
      const value = renderer.render(node);
      if (value.includes("\n")) lines.push("", `### ${label}`, "", value, "");
      else lines.push(`- **${label}:** ${value}`);
    }
  }
  if (description && plainText(description)) lines.push("", "## Descripción", "", renderer.render(description));
  if (instructions.length) {
    lines.push("", "## Instrucciones de despliegue");
    for (const [label, node] of instructions) lines.push("", `### ${label}`, "", renderer.render(node));
  }
  if (window.length) {
    lines.push("", "## Ventana de ejecución", "");
    for (const [label, node] of window) lines.push(`- **${label}:** ${renderer.render(node)}`);
  }
  const content = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return {
    content,
    assets,
    log: `${context.length + cabecera.length} campo(s) de contexto, ${instructions.length} sección(es) de instrucciones, ${assets.length} imagen(es) extraída(s)`,
  };
}
