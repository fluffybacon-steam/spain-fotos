"use client";
// src/components/Comments.tsx

import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import type { CommentDTO } from "@/types";

/** Loads lazily — only when the thread is actually opened for a photo. */
export default function Comments({
  photoId,
  onCountChange,
}: {
  photoId: string;
  onCountChange?: (n: number) => void;
}) {
  const [items, setItems] = useState<CommentDTO[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await fetch(`/api/photos/${photoId}/comments`);
      if (cancelled) return;
      if (res.ok) {
        const { comments } = await res.json();
        setItems(comments);
        onCountChange?.(comments.length);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);


  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch(`/api/photos/${photoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setItems((prev) => {
          const next = [...prev, comment];
          return next;
        })
        onCountChange?.(items.length);
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      } else {
        setDraft(body); // hand the text back rather than losing it
      }
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const before = items;
    setItems((prev) => {
      const next = prev.filter((c) => c.id !== id);
      // onCountChange?.(next.length);
      return next;
    });
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setItems(before);
      onCountChange?.(before.length);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="scroll-slim max-h-44 overflow-y-auto pr-1">
        {loading ? (
          <p className="coord animate-pulse">Loading comments</p>
        ) : items.length === 0 ? (
          <p className="coord">No comments yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((c) => (
              <li key={c.id} className="group flex gap-2">
                <Avatar url={c.authorAvatarUrl} name={c.authorName} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-semibold">{c.authorName}</span>{" "}
                    <span className="text-foam/90">{c.body}</span>
                  </p>
                  <p className="coord">
                    {new Date(c.createdAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {c.mine && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label="Delete comment"
                    className="coord shrink-0 opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
            <div ref={endRef} />
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="field flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment"
          maxLength={600}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            // The lightbox listens for arrows and Escape globally; stop them
            // here so typing doesn't flip to the next photo mid-sentence.
            e.stopPropagation();
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
        >
          Post
        </button>
      </div>
    </div>
  );
}
