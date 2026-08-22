type UtmifyWindow = Window & {
  utmify?: {
    track?: (name: string, params?: Record<string, unknown>) => void;
    trackEvent?: (name: string, params?: Record<string, unknown>) => void;
  };
  utmifyTrack?: (name: string, params?: Record<string, unknown>) => void;
  dataLayer?: Array<Record<string, unknown>>;
  __utmify_ic_status?: Record<string, unknown>;
};

function getUtmifyWindow() {
  return window as UtmifyWindow;
}

function sendWithOfficialPixel(name: string, params?: Record<string, unknown>): boolean {
  const w = getUtmifyWindow();

  try {
    if (typeof w.utmify?.track === "function") {
      w.utmify.track(name, params);
      return true;
    }
    if (typeof w.utmify?.trackEvent === "function") {
      w.utmify.trackEvent(name, params);
      return true;
    }
    if (typeof w.utmifyTrack === "function") {
      w.utmifyTrack(name, params);
      return true;
    }
  } catch (error) {
    console.error(`[UTMify] falha ao registrar ${name}:`, error);
  }

  return false;
}

function queueForPixel(name: string, params?: Record<string, unknown>) {
  const w = getUtmifyWindow();
  try {
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: name, ...(params ?? {}) });
  } catch (error) {
    console.error(`[UTMify] falha ao enfileirar ${name}:`, error);
  }
}

export function utmifyTrack(
  name: "PageView" | "ViewContent" | "InitiateCheckout" | (string & {}),
  params?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;
  if (!sendWithOfficialPixel(name, params)) queueForPixel(name, params);
}

export const CHECKOUT_URL = "https://go.invictuspay.app.br/gpn09mwxri";

let pendingInitiateCheckout: Promise<boolean> | null = null;
let pendingInitiateCheckoutKey = "";
let lastConfirmedKey = "";
let lastConfirmedAt = 0;

function initiateCheckoutKey(params?: Record<string, unknown>) {
  try {
    return JSON.stringify([
      params?.content_ids ?? null,
      params?.content_name ?? null,
      params?.value ?? null,
    ]);
  } catch {
    return String(params?.content_name ?? "checkout");
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function sendInitiateCheckout(params?: Record<string, unknown>): Promise<boolean> {
  const payload = {
    event_name: "InitiateCheckout",
    status: "IC",
    ...(params ?? {}),
  };

  // O pixel é carregado no pointerdown. Aguarda por no máximo 300 ms
  // e utiliza somente a interface oficial exposta pelo próprio pixel.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (sendWithOfficialPixel("InitiateCheckout", payload)) {
      getUtmifyWindow().__utmify_ic_status = { success: true, at: Date.now() };
      return true;
    }
    await wait(50);
  }

  // Se o script ainda não terminou de carregar, deixa o evento na fila.
  queueForPixel("InitiateCheckout", payload);
  getUtmifyWindow().__utmify_ic_status = { success: true, queued: true, at: Date.now() };
  return true;
}

export function trackInitiateCheckout(params?: Record<string, unknown>): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  const key = initiateCheckoutKey(params);
  const now = Date.now();

  // Bloqueia apenas duplo clique; um novo checkout real continua permitido.
  if (key === lastConfirmedKey && now - lastConfirmedAt < 2000) {
    return Promise.resolve(true);
  }
  if (pendingInitiateCheckout && pendingInitiateCheckoutKey === key) {
    return pendingInitiateCheckout;
  }

  const request = sendInitiateCheckout(params);
  pendingInitiateCheckout = request;
  pendingInitiateCheckoutKey = key;

  void request
    .then((ok) => {
      if (ok) {
        lastConfirmedKey = key;
        lastConfirmedAt = Date.now();
      }
    })
    .finally(() => {
      if (pendingInitiateCheckout === request) {
        pendingInitiateCheckout = null;
        pendingInitiateCheckoutKey = "";
      }
    });

  return request;
}

export function trackInitiateCheckoutFallback(params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const payload = {
    event_name: "InitiateCheckout",
    status: "IC",
    ...(params ?? {}),
  };
  if (!sendWithOfficialPixel("InitiateCheckout", payload)) {
    queueForPixel("InitiateCheckout", payload);
  }
}
