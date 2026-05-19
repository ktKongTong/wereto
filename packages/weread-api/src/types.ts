export const WEREAD_SKILL_VERSION = "1.0.3";

export type WereadApiName =
  | "/store/search"
  | "/book/info"
  | "/book/chapterinfo"
  | "/book/getprogress"
  | "/shelf/sync"
  | "/user/notebooks"
  | "/book/bookmarklist"
  | "/review/list/mine"
  | "/review/single"
  | "/readdata/detail"
  | "/_list"
  | (string & {});

export interface WereadGatewayRequest<TApiName extends WereadApiName = WereadApiName> {
  api_name: TApiName;
  skill_version?: string;
}

export interface WereadGatewayResponse {
  errcode?: number;
  errmsg?: string;
  upgrade_info?: {
    message: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SearchBookInfo {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  intro?: string;
  publisher?: string;
  category?: string;
  payType?: number;
  price?: number;
  soldout?: number;
}

export interface SearchBookItem {
  searchIdx: number;
  bookInfo: SearchBookInfo;
  readingCount?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: {
    title?: string;
    [key: string]: unknown;
  };
}

export interface SearchResultGroup {
  title?: string;
  scope?: number;
  scopeCount?: number;
  currentCount?: number;
  books?: SearchBookItem[];
}

export interface SearchBooksRequest extends WereadGatewayRequest<"/store/search"> {
  keyword: string;
  scope?: number;
  maxIdx?: number;
  count?: number;
}

export interface SearchBooksResponse extends WereadGatewayResponse {
  sid?: string;
  hasMore?: number;
  results?: SearchResultGroup[];
}

export interface BookInfoRequest extends WereadGatewayRequest<"/book/info"> {
  bookId: string;
}

export interface BookInfoResponse extends WereadGatewayResponse {
  bookId: string;
  title?: string;
  author?: string;
  translator?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: Record<string, unknown>;
}

export interface ChapterInfoRequest extends WereadGatewayRequest<"/book/chapterinfo"> {
  bookId: string;
}

export interface ChapterItem {
  chapterUid: number;
  chapterIdx?: number;
  title?: string;
  wordCount?: number;
  level?: number;
  updateTime?: number;
  price?: number;
  paid?: number;
  isMPChapter?: number;
  anchors?: Array<Record<string, unknown>>;
}

export interface ChapterInfoResponse extends WereadGatewayResponse {
  bookId: string;
  synckey?: number;
  chapterUpdateTime?: number;
  chapters?: ChapterItem[];
}

export interface BookProgressRequest extends WereadGatewayRequest<"/book/getprogress"> {
  bookId: string;
}

export interface BookProgressResponse extends WereadGatewayResponse {
  bookId?: string;
  book?: {
    chapterUid?: number;
    chapterOffset?: number;
    progress?: number;
    updateTime?: number;
    recordReadingTime?: number;
    finishTime?: number;
    isStartReading?: number;
    [key: string]: unknown;
  };
  timestamp?: number;
}

export interface ShelfSyncRequest extends WereadGatewayRequest<"/shelf/sync"> {}

export interface ShelfBookItem {
  bookId: string;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
  readUpdateTime?: number;
  finishReading?: number;
  updateTime?: number;
  isTop?: number;
  secret?: number;
}

export interface ShelfAlbumInfo {
  albumId: string;
  name?: string;
  authorName?: string;
  cover?: string;
  trackCount?: number;
  finishStatus?: string;
  finish?: number;
  payType?: number;
  intro?: string;
  updateTime?: number;
}

export interface ShelfAlbumInfoExtra {
  secret?: number;
  lecturePaid?: number;
  lectureReadUpdateTime?: number;
  isTop?: number;
}

export interface ShelfAlbumItem {
  albumInfo: ShelfAlbumInfo;
  albumInfoExtra?: ShelfAlbumInfoExtra;
}

export interface ShelfSyncResponse extends WereadGatewayResponse {
  books?: ShelfBookItem[];
  albums?: ShelfAlbumItem[];
  mp?: Record<string, unknown> | null;
  archive?: Array<{
    name?: string;
    bookIds?: string[];
  }>;
  bookCount?: number;
}

export interface UserNotebooksRequest extends WereadGatewayRequest<"/user/notebooks"> {
  count?: number;
  lastSort?: number;
}

export interface NotebookBookItem {
  bookId: string;
  book?: SearchBookInfo;
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
  readingProgress?: number;
  markedStatus?: number;
  sort?: number;
}

export interface UserNotebooksResponse extends WereadGatewayResponse {
  totalBookCount?: number;
  totalNoteCount?: number;
  hasMore?: number;
  books?: NotebookBookItem[];
}

export interface BookmarkListRequest extends WereadGatewayRequest<"/book/bookmarklist"> {
  bookId: string;
}

export interface BookmarkListItem {
  bookmarkId?: string;
  bookId?: string;
  chapterUid?: number;
  markText?: string;
  createTime?: number;
  type?: number;
  range?: string;
  colorStyle?: number;
}

export interface BookmarkListResponse extends WereadGatewayResponse {
  updated?: BookmarkListItem[];
  chapters?: ChapterItem[];
  book?: SearchBookInfo;
}

export interface ReviewListMineRequest extends WereadGatewayRequest<"/review/list/mine"> {
  bookid: string;
  synckey?: number;
  count?: number;
}

export interface ReviewAuthorInfo {
  userVid?: number | string;
  name?: string;
  avatar?: string;
}

export interface PersonalReviewDetail {
  reviewId?: string;
  content?: string;
  createTime?: number;
  star?: number;
  chapterName?: string;
  isFinish?: number;
  chapterUid?: number;
  range?: string;
  abstract?: string;
  bookId?: string;
  author?: ReviewAuthorInfo;
  [key: string]: unknown;
}

export interface PersonalReviewItem {
  review?: PersonalReviewDetail;
  [key: string]: unknown;
}

export interface ReviewListMineResponse extends WereadGatewayResponse {
  reviews?: PersonalReviewItem[];
  totalCount?: number;
  hasMore?: number;
  synckey?: number;
}

export interface ReviewSingleRequest extends WereadGatewayRequest<"/review/single"> {
  reviewId: string;
  commentsCount?: number;
  commentsDirection?: number;
  likesCount?: number;
  likesDirection?: number;
  synckey?: number;
}

export interface ReviewSingleResponse extends WereadGatewayResponse {
  reviewId?: string;
  review?: PersonalReviewDetail;
  htmlContent?: string;
  synckey?: number;
  comments?: Array<Record<string, unknown>>;
  likes?: Array<Record<string, unknown>>;
}

export interface ReadDataDetailRequest extends WereadGatewayRequest<"/readdata/detail"> {
  mode?: "weekly" | "monthly" | "annually" | "overall";
  baseTime?: number;
}

export interface ReadDataBucketMap {
  [timestamp: string]: number;
}

export interface ReadDataLongestBookInfo {
  bookId?: string;
  title?: string;
  author?: string;
  cover?: string;
}

export interface ReadDataLongestAlbumInfo {
  albumId?: string;
  name?: string;
  authorName?: string;
  cover?: string;
}

export interface ReadDataLongestItem {
  book?: ReadDataLongestBookInfo;
  albumInfo?: ReadDataLongestAlbumInfo;
  readTime?: number;
  recordReadingTime?: number;
  tags?: string[];
}

export interface ReadDataStatItem {
  stat?: string;
  counts?: string;
  scheme?: string;
}

export interface PreferCategoryItem {
  categoryId?: number;
  categoryTitle?: string;
  parentCategoryId?: number;
  parentCategoryTitle?: string;
  val?: number;
  readingTime?: number;
  readingCount?: number;
  categoryType?: number;
}

export interface PreferAuthorItem {
  authorId?: string | number;
  name?: string;
  count?: number;
  readTime?: string;
  user?: Record<string, unknown>;
}

export interface PreferPublisherItem {
  name?: string;
  count?: number;
}

export interface RankInfo {
  text?: string;
  scheme?: string;
}

export interface YearReportItem {
  year?: number;
  times?: number[];
  scheme?: string;
  [key: string]: unknown;
}

export interface ReadDataDetailResponse extends WereadGatewayResponse {
  baseTime?: number;
  readTimes?: ReadDataBucketMap;
  dailyReadTimes?: ReadDataBucketMap;
  readDays?: number;
  totalReadTime?: number;
  dayAverageReadTime?: number;
  compare?: number;
  readLongest?: ReadDataLongestItem[];
  readStat?: ReadDataStatItem[];
  preferCategory?: PreferCategoryItem[];
  preferCategoryWord?: string;
  preferTime?: number[];
  preferTimeWord?: string;
  preferAuthor?: PreferAuthorItem[];
  authorCount?: number;
  preferPublisher?: PreferPublisherItem[];
  rank?: RankInfo;
  registTime?: number;
  yearReport?: YearReportItem[];
  recordReadingTime?: number;
  readRate?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  [key: string]: unknown;
}

export type WereadKnownRequest =
  | SearchBooksRequest
  | BookInfoRequest
  | ChapterInfoRequest
  | BookProgressRequest
  | ShelfSyncRequest
  | UserNotebooksRequest
  | BookmarkListRequest
  | ReviewListMineRequest
  | ReviewSingleRequest
  | ReadDataDetailRequest;

export type WereadKnownResponse =
  | SearchBooksResponse
  | BookInfoResponse
  | ChapterInfoResponse
  | BookProgressResponse
  | ShelfSyncResponse
  | UserNotebooksResponse
  | BookmarkListResponse
  | ReviewListMineResponse
  | ReviewSingleResponse
  | ReadDataDetailResponse;
