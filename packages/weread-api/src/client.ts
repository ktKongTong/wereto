import ky, { type KyInstance, type Options } from "ky";

import {
  WereadApiError,
  WereadUpgradeRequiredError,
  normalizeWereadError,
} from "./errors.ts";
import {
  WEREAD_SKILL_VERSION,
  type BookInfoRequest,
  type BookInfoResponse,
  type BookProgressRequest,
  type BookProgressResponse,
  type ChapterInfoRequest,
  type ChapterInfoResponse,
  type BookmarkListRequest,
  type BookmarkListResponse,
  type ReadDataDetailRequest,
  type ReadDataDetailResponse,
  type ReviewListMineRequest,
  type ReviewListMineResponse,
  type ReviewSingleRequest,
  type ReviewSingleResponse,
  type SearchBooksRequest,
  type SearchBooksResponse,
  type ShelfSyncResponse,
  type UserNotebooksRequest,
  type UserNotebooksResponse,
  type WereadGatewayRequest,
  type WereadGatewayResponse,
  type MonthlyReadDataDetailRequest,
  type AnnuallyReadDataDetailRequest,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://i.weread.qq.com/api/agent/gateway";

export interface WereadClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number | false;
  totalTimeout?: number | false;
  retry?: Options["retry"];
  headers?: HeadersInit;
  fetch?: typeof globalThis.fetch;
  skillVersion?: string;
  onRequest?: (request: Request) => void | Promise<void>;
  onResponse?: (response: Response, request: Request) => void | Promise<void>;
}

export class WereadClient {
  public readonly skillVersion: string;
  public readonly ky: KyInstance;

  constructor(options: WereadClientOptions = {}) {
    this.skillVersion = options.skillVersion ?? WEREAD_SKILL_VERSION;
    this.ky = createKyInstance(options);
  }

  extend(options: WereadClientOptions = {}): WereadClient {
    const client = new WereadClient({
      ...options,
      skillVersion: options.skillVersion ?? this.skillVersion,
    });

    return client.withKy(this.ky.extend(buildExtendOptions(options)));
  }

  async request<TResponse extends WereadGatewayResponse, TRequest extends WereadGatewayRequest>(
    payload: TRequest,
  ): Promise<TResponse> {
    const response = await this.ky
      .post("", {
        json: {
          ...payload,
          skill_version: payload.skill_version ?? this.skillVersion,
        },
      })
      .json<TResponse>();

    this.assertGatewayResponse(response);
    return response;
  }

  searchBooks(payload: Omit<SearchBooksRequest, "api_name" | "skill_version">): Promise<SearchBooksResponse> {
    return this.request<SearchBooksResponse, SearchBooksRequest>({
      api_name: "/store/search",
      ...payload,
    });
  }

  getBookInfo(payload: Omit<BookInfoRequest, "api_name" | "skill_version">): Promise<BookInfoResponse> {
    return this.request<BookInfoResponse, BookInfoRequest>({
      api_name: "/book/info",
      ...payload,
    });
  }

  getChapterInfo(
    payload: Omit<ChapterInfoRequest, "api_name" | "skill_version">,
  ): Promise<ChapterInfoResponse> {
    return this.request<ChapterInfoResponse, ChapterInfoRequest>({
      api_name: "/book/chapterinfo",
      ...payload,
    });
  }

  getProgress(
    payload: Omit<BookProgressRequest, "api_name" | "skill_version">,
  ): Promise<BookProgressResponse> {
    return this.request<BookProgressResponse, BookProgressRequest>({
      api_name: "/book/getprogress",
      ...payload,
    });
  }

  getShelf(): Promise<ShelfSyncResponse> {
    return this.request<ShelfSyncResponse, WereadGatewayRequest>({
      api_name: "/shelf/sync",
    });
  }

  getNotebooks(
    payload: Omit<UserNotebooksRequest, "api_name" | "skill_version"> = {},
  ): Promise<UserNotebooksResponse> {
    return this.request<UserNotebooksResponse, UserNotebooksRequest>({
      api_name: "/user/notebooks",
      ...payload,
    });
  }

  getBookmarkList(
    payload: Omit<BookmarkListRequest, "api_name" | "skill_version">,
  ): Promise<BookmarkListResponse> {
    return this.request<BookmarkListResponse, BookmarkListRequest>({
      api_name: "/book/bookmarklist",
      ...payload,
    });
  }

  getMyReviews(
    payload: Omit<ReviewListMineRequest, "api_name" | "skill_version">,
  ): Promise<ReviewListMineResponse> {
    return this.request<ReviewListMineResponse, ReviewListMineRequest>({
      api_name: "/review/list/mine",
      ...payload,
    });
  }

  getReviewSingle(
    payload: Omit<ReviewSingleRequest, "api_name" | "skill_version">,
  ): Promise<ReviewSingleResponse> {
    return this.request<ReviewSingleResponse, ReviewSingleRequest>({
      api_name: "/review/single",
      ...payload,
    });
  }

  getReadData(
    payload: Omit<ReadDataDetailRequest, "api_name" | "skill_version"> = {},
  ): Promise<ReadDataDetailResponse> {
    return this.request<ReadDataDetailResponse, ReadDataDetailRequest>({
      api_name: "/readdata/detail",
      ...payload,
    });
  }

  getAnnuallyReadData({ year, ...rest }: Omit<AnnuallyReadDataDetailRequest, "api_name" | "skill_version"> = {}): Promise<ReadDataDetailResponse> {
    const y = new Date().getUTCFullYear()
    return this.request<ReadDataDetailResponse, ReadDataDetailRequest>({
      api_name: "/readdata/detail",
      baseTime: Math.floor(Date.UTC(year || y, 0, 1) / 1000),
      mode: 'annually',
      ...rest,
    });
  }

  getMonthlyReadData({ year, month, ...rest }: Omit<MonthlyReadDataDetailRequest, "api_name" | "skill_version"> = {}): Promise<ReadDataDetailResponse> {
    const y = new Date().getUTCFullYear()
    return this.request<ReadDataDetailResponse, ReadDataDetailRequest>({
      api_name: "/readdata/detail",
      baseTime: Math.floor(Date.UTC(year || y, (month??0) + 1, 1) / 1000),
      mode: 'monthly',
      ...rest,
    });
  }

  private assertGatewayResponse(response: WereadGatewayResponse): void {
    if (response.upgrade_info?.message) {
      throw new WereadUpgradeRequiredError(response.upgrade_info.message, response.upgrade_info);
    }

    if ((response.errcode ?? 0) !== 0) {
      throw new WereadApiError(
        response.errmsg ?? `WeRead API returned errcode=${response.errcode}`,
        response.errcode ?? -1,
        response,
      );
    }
  }

  private withKy(instance: KyInstance): WereadClient {
    return Object.assign(Object.create(WereadClient.prototype), {
      ky: instance,
      skillVersion: this.skillVersion,
    }) as WereadClient;
  }
}

export function createWereadClient(options: WereadClientOptions = {}): WereadClient {
  return new WereadClient(options);
}

function createKyInstance(options: WereadClientOptions): KyInstance {
  const apiKey = options.apiKey ?? process.env.WEREAD_API_KEY;

  const baseOptions: Options = {
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    method: "post",
    timeout: options.timeout ?? 30_000,
    retry: options.retry ?? {
      limit: 2,
      methods: ["post"],
      statusCodes: [408, 413, 429, 500, 502, 503, 504],
    },
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...options.headers,
    },
    hooks: {
      ...buildHooks(options),
      beforeError: [async ({ error }) => normalizeWereadError(error)],
    },
  };

  if (options.totalTimeout !== undefined) {
    baseOptions.totalTimeout = options.totalTimeout;
  }

  if (options.fetch) {
    baseOptions.fetch = options.fetch;
  }

  return ky.create(baseOptions);
}

function buildHooks(options: WereadClientOptions): NonNullable<Options["hooks"]> {
  const hooks: NonNullable<Options["hooks"]> = {};

  if (options.onRequest) {
    hooks.beforeRequest = [
      async ({ request }) => {
        await options.onRequest?.(request);
      },
    ];
  }

  if (options.onResponse) {
    hooks.afterResponse = [
      async ({ request, response }) => {
        await options.onResponse?.(response, request);
      },
    ];
  }

  return hooks;
}

function buildExtendOptions(options: WereadClientOptions): Options {
  const extendOptions: Options = {
    hooks: buildHooks(options),
  };

  if (options.baseUrl !== undefined) {
    extendOptions.baseUrl = options.baseUrl;
  }

  if (options.timeout !== undefined) {
    extendOptions.timeout = options.timeout;
  }

  if (options.totalTimeout !== undefined) {
    extendOptions.totalTimeout = options.totalTimeout;
  }

  if (options.retry !== undefined) {
    extendOptions.retry = options.retry;
  }

  if (options.fetch) {
    extendOptions.fetch = options.fetch;
  }

  if (options.headers) {
    extendOptions.headers = options.headers;
  }

  return extendOptions;
}
