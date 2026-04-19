/**
 * tweet-queue.ts — Persistent tweet queue stored on VPS filesystem
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = resolve(__dirname, "../data/tweet-queue.json");

export interface QueuedTweet {
  id: string;
  text: string;
  character: "semar" | "gareng" | "petruk" | "bagong";
  topic: string;
  targetInteraction: "reply" | "retweet" | "like" | "bookmark";
  status: "pending" | "posted" | "rejected";
  createdAt: string;
  postedAt?: string;
  // Reply context — diisi kalau tweet ini adalah balasan ke tweet lain
  replyToId?: string;
  replyToUser?: string;
  replyToText?: string;
  // Thread context — diisi kalau tweet ini bagian dari thread
  threadId?: string;
  threadIndex?: number;  // 0-based
  threadTotal?: number;
}

export function loadQueue(): QueuedTweet[] {
  if (!existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveQueue(tweets: QueuedTweet[]) {
  const dir = resolve(__dirname, "../data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(tweets, null, 2), "utf-8");
}

export function addToQueue(tweet: Omit<QueuedTweet, "id" | "status" | "createdAt">): QueuedTweet {
  const tweets = loadQueue();
  // Pakai Date.now() + random suffix supaya tidak collision dalam loop
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newTweet: QueuedTweet = {
    ...tweet,
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  tweets.unshift(newTweet);
  saveQueue(tweets);
  return newTweet;
}

export function updateTweetStatus(id: string, status: "posted" | "rejected", extra: Partial<QueuedTweet> = {}): boolean {
  const tweets = loadQueue();
  const tweet = tweets.find((t) => t.id === id);
  if (!tweet) return false;
  Object.assign(tweet, { status, ...extra });
  saveQueue(tweets);
  return true;
}
