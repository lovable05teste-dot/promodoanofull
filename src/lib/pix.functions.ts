import { createServerFn } from "@tanstack/react-start";

// Gateway da cópia isolada: FlevoPay.
import {
  createFlevopayPixCharge,
  readFlevopayPixStatus,
  type PixChargeInput,
  type PixChargeResult,
} from "./pix.server";

export const createPixCharge = createServerFn({ method: "POST" })
  .inputValidator((data: PixChargeInput) => data)
  .handler(async ({ data }): Promise<PixChargeResult> => {
    const apiKey = process.env.FLEVOPAY_API_KEY;
    if (!apiKey) {
      throw new Error(
        "FlevoPay não está configurada. Adicione FLEVOPAY_API_KEY nas variáveis do servidor.",
      );
    }

    return createFlevopayPixCharge(data, {
      apiKey,
      baseUrl: process.env.FLEVOPAY_BASE_URL,
      postbackUrl: process.env.FLEVOPAY_POSTBACK_URL,
    });
  });

export const getPixStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { transactionId: string }) => data)
  .handler(async ({ data }): Promise<{ status: string; paidAt?: string }> => {
    const apiKey = process.env.FLEVOPAY_API_KEY;
    if (!apiKey) return { status: "PENDING" };

    return readFlevopayPixStatus(
      data.transactionId,
      apiKey,
      process.env.FLEVOPAY_BASE_URL,
    );
  });
