import * as fs from "fs";
import * as path from "path";
import { zipSync, Zippable } from "fflate";
import * as QRCode from "qrcode";

export interface QrEncodeConfig {
  /** Bytes de datos por fragmento (el límite físico de un QR v40-L es ~2940 con cabecera). */
  chunkSize: number;
}

export interface QrFrameSet {
  syncSvg: string;
  dataSvgs: string[];
  zipSize: number;
  sourceLabel: string;
}

/** Capacidad máxima de un QR versión 40 con corrección L en modo byte. */
const QR_MAX_BYTES = 2953;

function recogerArchivos(dir: string, prefijo: string, destino: Zippable): void {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    const relativo = `${prefijo}/${entrada.name}`;
    if (entrada.isDirectory()) {
      recogerArchivos(completo, relativo, destino);
    } else if (entrada.isFile()) {
      destino[relativo] = fs.readFileSync(completo);
    }
  }
}

/**
 * Comprime un archivo o carpeta en un ZIP en memoria, con la misma estructura
 * que shutil.make_archive: el archivo queda en la raíz; una carpeta conserva
 * su nombre como prefijo de todas las entradas.
 */
export function crearZip(ruta: string): Uint8Array {
  const base = path.basename(ruta);
  const entradas: Zippable = {};
  if (fs.statSync(ruta).isDirectory()) {
    recogerArchivos(ruta, base, entradas);
    if (Object.keys(entradas).length === 0) {
      throw new Error("La carpeta está vacía: no hay nada que transmitir.");
    }
  } else {
    entradas[base] = fs.readFileSync(ruta);
  }
  return zipSync(entradas, { level: 6 });
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export async function generarQrFrames(
  ruta: string,
  cfg: QrEncodeConfig,
  onProgress?: (hechos: number, total: number) => void
): Promise<QrFrameSet> {
  if (!ruta || !fs.existsSync(ruta)) {
    throw new Error("Ruta de origen no válida.");
  }

  const zipData = crearZip(ruta);
  const totalChunks = Math.ceil(zipData.length / cfg.chunkSize);

  // La cabecera crece con el número de fragmentos (P:100/100| son 10 bytes).
  const headerLen = `P:${pad2(totalChunks)}/${pad2(totalChunks)}|`.length;
  if (cfg.chunkSize + headerLen > QR_MAX_BYTES) {
    throw new Error(
      `Chunk de ${cfg.chunkSize} bytes + cabecera de ${headerLen} supera el límite ` +
        `de un QR (${QR_MAX_BYTES} bytes). Usa un chunk de ${QR_MAX_BYTES - headerLen} o menos.`
    );
  }

  const syncSvg = await QRCode.toString(`SYNC|${totalChunks}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });

  const dataSvgs: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = zipData.subarray(i * cfg.chunkSize, (i + 1) * cfg.chunkSize);
    const header = Buffer.from(`P:${pad2(i + 1)}/${pad2(totalChunks)}|`, "utf8");
    const payload = Buffer.concat([header, Buffer.from(chunk)]);

    dataSvgs.push(
      await QRCode.toString([{ data: payload, mode: "byte" }], {
        type: "svg",
        errorCorrectionLevel: "L",
        margin: 2,
      })
    );
    onProgress?.(i + 1, totalChunks);
  }

  return {
    syncSvg,
    dataSvgs,
    zipSize: zipData.length,
    sourceLabel: path.basename(ruta),
  };
}
