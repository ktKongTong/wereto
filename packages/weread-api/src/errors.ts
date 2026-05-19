import { HTTPError, TimeoutError, isHTTPError, isTimeoutError } from "ky";

export class WereadApiError extends Error {
  public readonly errcode: number;
  public readonly responseBody: unknown;

  constructor(message: string, errcode: number, responseBody: unknown) {
    super(message);
    this.name = "WereadApiError";
    this.errcode = errcode;
    this.responseBody = responseBody;
  }
}

export class WereadUpgradeRequiredError extends Error {
  public readonly upgradeInfo: unknown;

  constructor(message: string, upgradeInfo: unknown) {
    super(message);
    this.name = "WereadUpgradeRequiredError";
    this.upgradeInfo = upgradeInfo;
  }
}

export class WereadHttpError extends Error {
  public readonly status: number;
  public readonly responseText: string | undefined;

  constructor(message: string, status: number, responseText?: string) {
    super(message);
    this.name = "WereadHttpError";
    this.status = status;
    this.responseText = responseText;
  }
}

export class WereadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WereadTimeoutError";
  }
}

export async function normalizeWereadError(error: unknown): Promise<Error> {
  if (isHTTPError(error)) {
    return convertHttpError(error);
  }

  if (isTimeoutError(error)) {
    return new WereadTimeoutError(error.message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown WeRead client error");
}

async function convertHttpError(error: HTTPError): Promise<WereadHttpError> {
  let responseText: string | undefined;

  try {
    responseText = await error.response.clone().text();
  } catch {
    responseText = undefined;
  }

  return new WereadHttpError(
    `WeRead HTTP error: ${error.response.status} ${error.response.statusText}`,
    error.response.status,
    responseText,
  );
}

export function isKyTimeoutError(error: unknown): error is TimeoutError {
  return isTimeoutError(error);
}
