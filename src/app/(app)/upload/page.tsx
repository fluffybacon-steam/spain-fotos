// src/app/(app)/upload/page.tsx
import Link from "next/link";
import Uploader from "@/components/Uploader";

export default function UploadPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Add to the chart</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Upload</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
      </div>

      <Uploader />

      <section className="mt-12 border-t border-hairline pt-6">
        <p className="eyebrow mb-1 flash-text">READ ME</p>
        <ul className="flex flex-col gap-2.5 text-sm text-haze">
          <li>
            <strong className="text-foam">Send originals, not forwards.</strong> WhatsApp, Telegram
            and Google Photos links all re-encode the file and drop the GPS tags on the way.
          </li>
          <li>
            <strong className="text-foam">On iPhone,</strong> check Settings → Privacy → Location
            Services → Camera is on, and that the share sheet&apos;s Options → Location toggle
            stayed enabled.
          </li>
          <li>
            <strong className="text-foam">On Android,</strong> the Camera app has a Location or
            Store Location setting that has to be on at the time the photo was taken.
          </li>
          <li>
            Screenshots and scans never had coordinates. Pin those by hand from the map. or don't, its your life
          </li>
        </ul>
      </section>
    </main>
  );
}
