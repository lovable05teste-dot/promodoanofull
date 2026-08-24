const DEFAULT_FLEVOPAY_BASE_URL = "https://app.flevopay.com.br";
const ALLOWED_FLEVOPAY_HOSTS = new Set(["app.flevopay.com.br"]);

export type PixChargeInput = {
  name: string;
  document: string;
  email: string;
  phone: string;
  utm?: string;
  amountCents?: number;
  itemTitle?: string;
};

export type PixChargeResult = { pixCode: string; transactionId: string };

type JsonRecord = Record<string, unknown>;

export const onlyDigits = (value: string) => (value || "").replace(/\D+/g, "");

export function normalizePhone(value: string) {
  let phone = onlyDigits(value);
  if (phone.length > 11 && phone.startsWith("55")) phone = phone.slice(2);
  while (phone.length > 11 && phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length === 12 && phone.startsWith("0")) phone = phone.slice(1);
  return phone;
}

function buildTracking(utm?: string): Record<string, string> {
  const params = new URLSearchParams((utm || "").replace(/^\?/, ""));
  const tracking: Record<string, string> = {};
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "src",
    "sck",
  ]) {
    const value = params.get(key)?.trim();
    if (value) tracking[key] = value;
  }
  if (!tracking.utm_source && tracking.src) tracking.utm_source = tracking.src;
  if (!tracking.src && tracking.utm_source) tracking.src = tracking.utm_source;
  return tracking;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const direct = value[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);
  }
  for (const nested of Object.values(value)) {
    const found = findStringByKeys(nested, keys);
    if (found) return found;
  }
  return undefined;
}

function findPixCode(value: unknown) {
  return findStringByKeys(value, [
    "qr_code",
    "pix_code",
    "pix_qr_code",
    "copy_paste",
    "copia_cola",
    "payload",
  ]);
}

function normalizeBaseUrl(baseUrl?: string) {
  try {
    const parsed = new URL(baseUrl || DEFAULT_FLEVOPAY_BASE_URL);
    if (parsed.protocol !== "https:" || !ALLOWED_FLEVOPAY_HOSTS.has(parsed.hostname)) {
      throw new Error("host não permitido");
    }
    return parsed.origin;
  } catch {
    return DEFAULT_FLEVOPAY_BASE_URL;
  }
}

function safeGatewayMessage(raw: string) {
  try {
    const data = JSON.parse(raw) as JsonRecord;
    const message = findStringByKeys(data, ["message", "error"]);
    return message ? `: ${message.slice(0, 160)}` : "";
  } catch {
    return "";
  }
}

async function flevopayFetch(
  path: string,
  init: RequestInit & { apiKey: string; baseUrl?: string },
) {
  const { apiKey, baseUrl, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": apiKey,
        ...(rest.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("A FlevoPay demorou para responder. Tente gerar o Pix novamente.");
    }
    throw new Error("Não foi possível conectar à FlevoPay. Tente novamente.");
  } finally {
    clearTimeout(timeout);
  }
}

function createReference() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 14);
  return `SITE-${Date.now()}-${suffix}`;
}

export async function createFlevopayPixCharge(
  input: PixChargeInput,
  config: { apiKey: string; baseUrl?: string; postbackUrl?: string },
): Promise<PixChargeResult> {
  const name = (input.name || "").trim();
  const document = onlyDigits(input.document);
  const email = (input.email || "").trim();
  const phone = normalizePhone(input.phone);

  if (!name) throw new Error("Nome é obrigatório.");
  if (document.length !== 11 && document.length !== 14) {
    throw new Error("CPF/CNPJ inválido. Informe apenas os números do documento.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email inválido.");
  if (phone.length !== 10 && phone.length !== 11) {
    throw new Error("Telefone inválido. Informe DDD + número.");
  }

  const amount =
    Number.isFinite(input.amountCents) && (input.amountCents ?? 0) > 0
      ? Math.round(input.amountCents as number)
      : 6193;

  const payload: JsonRecord = {
    amount,
    description: (input.itemTitle || "Produto").slice(0, 120),
    reference: createReference(),
    source: "api_externa",
    customer: { name, email, document, phone },
  };

  const tracking = buildTracking(input.utm);
  if (Object.keys(tracking).length) payload.tracking = tracking;
  if (config.postbackUrl?.startsWith("https://")) payload.postback_url = config.postbackUrl;

  const response = await flevopayFetch("/api/v1/transaction", {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    method: "POST",
    body: JSON.stringify(payload),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      `A FlevoPay recusou a geração do Pix (${response.status})${safeGatewayMessage(raw)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("A FlevoPay retornou uma resposta inválida.");
  }

  const pixCode = findPixCode(json);
  const transactionId = findStringByKeys(json, ["transaction_id", "id"]);
  if (!pixCode || !transactionId) {
    throw new Error("A FlevoPay não retornou o código Pix completo.");
  }

  return { pixCode, transactionId };
}

export async function readFlevopayPixStatus(
  transactionId: string,
  apiKey: string,
  baseUrl?: string,
) {
  try {
    const path = `/api/v1/query?action=get_transaction&id=${encodeURIComponent(transactionId)}`;
    const response = await flevopayFetch(path, {
      apiKey,
      baseUrl,
      method: "GET",
    });
    if (!response.ok) return { status: "PENDING" };

    const json = (await response.json()) as JsonRecord;
    const rawStatus = String(findStringByKeys(json, ["status"]) || "pending").toLowerCase();
    const status =
      rawStatus === "approved" || rawStatus === "paid" || rawStatus === "completed"
        ? "COMPLETED"
        : rawStatus === "refunded" ||
            rawStatus === "chargeback" ||
            rawStatus === "failed" ||
            rawStatus === "cancelled" ||
            rawStatus === "canceled"
          ? rawStatus.toUpperCase()
          : "PENDING";

    return {
      status,
      paidAt: findStringByKeys(json, ["paid_at", "paidAt", "approved_at"]),
    };
  } catch {
    return { status: "PENDING" };
  }
}
