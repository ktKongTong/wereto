import { loadEnvFile } from "node:process";

import { createWereadClient } from "../src/index.ts";

loadEnvFile();

async function main() {
  const keyword = process.argv[2] ?? "三体";
  const count = Number(process.argv[3] ?? "5");

  const client = createWereadClient({
    onRequest(request) {
      console.log("->", request.method, request.url);
    },
    onResponse(response) {
      console.log("<-", response.status, response.statusText);
    },
  });

  const search = await client.searchBooks({
    keyword,
    scope: 10,
    count,
  });

  const books =
    search.results?.flatMap((group) => group.books ?? []).map((item, index) => ({
      index: index + 1,
      bookId: item.bookInfo.bookId,
      title: item.bookInfo.title,
      author: item.bookInfo.author,
      rating: item.newRating ? (item.newRating / 10).toFixed(1) : undefined,
      ratingCount: item.newRatingCount,
      readingCount: item.readingCount,
    })) ?? [];

  console.log(JSON.stringify({ keyword, count, books }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
